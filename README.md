# Multi-writer hyperbee
This repository owes origins of its design to [@RangerMauve](https://github.com/RangerMauve)'s awesome [multi-hyperdrive](https://github.com/RangerMauve/multi-hyperdrive), and of course, the very awesome [Hyperbee](https://github.com/mafintosh/hyperbee) and the [whole of Hypercore](https://hypercore-protocol.org).

## About
A LevelUP compatible leaderless multi-master database with eventual consistency, using hyperbee + CRDT + HLC.  Similarly CockroachDB achieves replication on top of RocksDB, but here it is a pure P2P [streaming](https://github.com/tradle/why-hypercore/blob/master/FAQ.md#what-is-the-usp-unique-selling-proposition-of-hypercore) database, with zero central management. LevelDB compatibility allows to use Dynalite on top to achieve [DynamoDB compatibility](https://aws.amazon.com/dynamodb/) with multiple tables, auto-updated secondary indexes, and fairly complex queries combining those indexes. Work on @mhart's [Dynalite](https://github.com/tradle/dynalite) is almost completed to remove the HTTP server, to make this combination perfect as an embedded database and for serverless scenarios.

## The need
[Hyperbee](https://github.com/mafintosh/hyperbee) is one-of-a-kind steaming database that can change the way we work with the databases. But like all other low-level components of hypercore ecosystem it is a single-writer data structure. Multi-writer is a higher-level abstraction, hence the name multi-hyperbee.

## Use cases
- Multi-device support. One or more devices are personal cloud peers.
- Later we will consider a shared DB for a team 

### Algorithm
*This is a third interation of the design, previous is described and implemented in the release tagged v0.1.*

In the prior design we had a primary hyperbee and sparse replicas of other peers' primary hyperbees. 
In the new design the full object is not replicated to the peers, only its diff (this design eliminated the ping-pong problem of the prior design as the store is not replicated).

In this design we have 2 hyperbees into which we write, `store` and `diff`. `Store` contains a full set of fresh objects (and their older versions, as does any hypercore). `Diff` contains only the specially formatted  objects (our custom CRDT format) that represent modifications to local objects. Every peer replicates other peers' `diff` hyperbees (but not the `store`).
Upon `diff` hyperbee getting an update() event, we apply the received diff object to the store using the algo below: 

For the CRDT algorithm to do its magic, we first rewind to the proper object version and then apply local diffs and a newly arrived remote diff:

- remote diff refers to the version of the object that was nodified on remote peer
- we find the same version of the object in store
- we find all diffs that were applied locally since that version
- we sort all local diffs and the remote diff by time, and apply them in that order
- new version of the object is put() into store

This algorithm ensures that all peers have the store in exactly the same state. 

### Extend support to Hyperdrive
In this version we only add multi-writer to Hyperbee. But we can extend it to Trie and Drive. Here are our thoughts on how this might work.

Previous version of the design did not have a `diff` feed and thus followed multi-hyperdrive's design more closely. Multi-hyperdrive does not apply updates to the primary, which we did even in the initial version of multi-hyperbee. Instead on each read it checks on the fly which file is fresher and returns that file (It checks in primary and in all the replicas from peers). It also supports on-the-fly merging of the directory listings, without changing any structures on disk. In this design we deviated even further as we needed to support CRDT merging.

To implement CRDT for Hyperdrive files, we might need to change multi-hyperdrive's design to use the `diff` feed:

- CRDT diff must apply to the local (primary) hyperdrive. Multi-hyperdrive does not do that, keeping all changed files in the replica.
- file diff in CRDT format is 3x the size of the changed data, so might warrant a second `diff` feed, to avoid slowing down DB replication. Hyperdrive uses 2 structures, hypertrie for directory and file metadata and hypercore for data. So changes in hypertrie can be propagated via `diff` and. 

## Cost and future optimizations
**Read performance**: equals normal hyperbee performance
**Write performance**: quite expensive:
- Diff coming from replica is written to disk
- Union range query across all diff replicas and primary diff to find diffs since a particualr HLC time
- Reed matching version of the object in store
- Merge in memory and Write new version to store

## Failure modes discussion 

- update() event on replica occured and computer died before we applied it to store. Will it arrive again?
- HLC clock needs to be restored on restart

## Usage
``` js
const MultiHyperbee = require('multi-hyperbee')

const hyperbeeOpts = { keyEncoding: 'utf-8', valueEncoding: 'json' }
const multiHyperbee = new MultiHyperbee(storage, { hyperbeeOpts })

// Each app usually has its own key exchange mechanism with remote peers. So after exchange is completed, 
// we will know the keys of the peer's diff feeds. To receive updates from them, you need to add them here. Repeat for all remote peers.
{
  await multiHyperbee.addPeer(peerDiffFeedKey)
}  
```

## API
### const db = new MultiHyperbee(storage, [options], [customMergeHandler])

creates a new MultiHyperbee with two single-writer hypercores: 
- **Store** - a hyperbee into which we will store objects created/changed locally or received from peers. This hyperbee is not replicated to peers. Multi-hyperbee's main goal is to achieve convergence, that is to keep this store in exactly the same state as store on other peers. This can't happen synchronously as peers are not expected to be only all the time, but eventually.
- **Diff** - here we store all changes made locally. Other peers replicate this and merge each diff into their own store.
Options included:
``` js
{
  keyEncoding: 'utf-8' | 'binary' | 'ascii', // or some abstract encoding
  valueEncoding: <same as above>
}
```
**customMergeHandler** - CRDT handler to apply changes to the Object. 
If not using default, it should be implemented in a following way
```
class MergeHandler {
  constructor(store) {
    this.store = store
  }
  // It'll apply diff to the correct version of an object 
  merge(diff) {  
  }
  // That will generate diff based on the last version of the object in the store. 
  genDiff(oldValue, newValue) {
    return diff
  }
}
```
### await db.put(key, storeValue)

Put will write two objects at the same time to Store and to Diff hyperbee.
Put will add to each of the objects following properties:

to Store object:
- _objectId - which is the same as key
- _timestamp - HLC timestamp
- _prevTimestamp - if the objct is not new

to Diff object
- _timestamp
- _prevTimestamp to the Diff.obj property if the Store object is not new

Diff object will be put with the key ```key/_timestamp``` 

Diff object can be set as a property of the storeValue or it will be generated by MultiHyperbee based on the previous version of the resource in the Store (that still needs to ).
If Diff is set as a property of the value it should be added to Object as property **_diff**. It will be deleted from the Store object and won't be a part of the Store object

Check the diff format [here](https://github.com/tradle/multi-hyperbee/blob/master/test/constants.js)

Diff object that is written to diffHyperbee will have a key that is consists of 2 parts:
- storeValue key
- storeValue timestamp

## const replicaPeer = await db.addPeer(replicaKey)

Created replica Hyperbee using replica key 

## const replicaPeer = db.removePeer(replicaKey)

removes replica Hyperbee

## const stream = db.createUnionStream(key)

Use it for writing your own custom merge handler.
It creates a union stream from all the replica hyperbees where all the entries are the Diff objects. 
It runs on each replica hyperbee.
``` js
// key has timestamp in it. To limit the search we define the top limit as a key without the timestamp

let lte = key.split('/').slice(0, -1).join('/')
createReadStream({gte: key, lte })
```
It is used by mergeHandler for applying changes to the Store object when for example:
- Say device was offline for some time, 
- User made changes on his other devices.
- When device comes online again it needs to catch up with all other devices

the rest of API is the same as [Hyperbee](https://github.com/mafintosh/hyperbee)

### Roadmap

- MH - generate diff for insert/remove to array changes
- **batch** is not yet supported
- Tighten the non-atomic failure modes when process dies after writing to `diff` and before writing to `store`, or after reading from `feed` and applying to `store'.
- Support multiple bees, tries. We invision that peers will use one replication log to establish multi-writer for any number of shared data structures, that is for data structures local and remote peers can write into simultaneously. Using one replication log can help support atomic changes across multiple data structures.

