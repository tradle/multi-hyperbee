# Multi-writer hyperbee
This repository owes origins of its design to [@RangerMauve](https://github.com/RangerMauve)'s awesome [multi-hyperdrive](https://github.com/RangerMauve/multi-hyperdrive), and of course, the very awesome [Hyperbee](https://github.com/mafintosh/hyperbee) and the [whole of Hypercore](https://hypercore-protocol.org).

## The need
[Hyperbee](https://github.com/mafintosh/hyperbee) is one-of-a-kind steaming database that can change the way we work with the databases. But like all other low-level components of hypercore ecosystem it is a single-writer data structure. Multi-writer is a higher-level abstraction, hence the name multi-hyperbee.

### Algorithm
*This is a third interation of the design, previous is described and implemented in the release tagged v0.1.*

In the prior design we had a primary hyperbee and sparse replicas of other peers' primary hyperbees. 
In the new design the full object is not replicated to the peers, only its diff (this design eliminated the ping-pong problem of the prior design as the store is not replicated).

In this design we have 2 hyperbees into which we write, `store` and `diff`. Store contains a full set of fresh objects (and their older versions, as does any hypercore). Diff contains only the specially formatted  objects (our custom CRDT format) that represent modifications to local objects. Every peer replicates other peers' diff hyperbees (but not the store).
Upon diff hyperbee getting an update() event, we apply diff to the store. 

For the CRDT algorithm to do its magic, we first rewind to the proper object version and then apply local diffs and a newly arrived remote diff:

- remote diff refers to the version of the object that was nodified on remote peer
- we find the same version of the object in store
- we find all diffs that were applied locally since that version
- we sort all local diffs and the remote diff by time, and apply them in that order
- new version of the object is put() into store

This algorithm ensures that all peers have the store in exactly the same state.

Previous version of the design followed multi-hyperdrive design closely. The difference wa that multi-hyperdrive does not apply updates to the primary, and instead it performs checks which file is fresher on the fly, in primary or in all the replicas, and then it reads that one (it also does a clever on the fly merging of directory listing requests). 

## Intergrating with Hyperdrive (planned)
- file diff feed in CRDT format (each change could be quite big, so may need a separate diff feed)
- TBD: CRDT diff must apply to a local hyperdrive, but this creates a ping pong problem

## Use cases
- Multi-device support. One or more devices are personal cloud peers.
- Later we will consider a shared DB for a team 

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
const hypercore = require('hypercore')
const Hyperbee = require('hyperbee')

const feedOpts = { valueEncoding: 'json' }
const hyperbeeOpts = { keyEncoding: 'utf-8', valueEncoding: 'json' }
async init() {
  ...
  // Diff feed. We will write here all changes.
  // In the future this feed may receive diffs from multiple bees, tries and drives
  const diffFeed = hypercore(diffStorage, feedOpts)
  const diffHyperbee = new Hyperbee(diffFeed, hyperbeeOpts)
  await diffHyperbee.ready()

  // Store. Local database which will be kept in sync with remote peers via the the diff feed
  const feed = hypercore(storage, feedOpts)
  const multiHyperbee = new MultiHyperbee(feed, {diffHyperbee, opts: hyperbeeOpts})
}

// Each app usually has its own key exchange mechanism with remote peers. So after exchange is completed, 
// we know the keys of the peer's diff feeds. To receive updates from them, you need to add them here. Repeat for all remote peers.
{
  ...
  const peerDiffFeed = hypercore(replicaStorage, peerDiffFeedKey, {...feedOpts})
  const peerDiff = new Hyperbee(peerDiffFeed, hyperbeeOpts)
  await peerDiff.ready()

  multiHyperbee.addHyperbee(peerDiff)
}  
```

## API
### const db = new MultiHyperbee(feed, {peerDiff, [options]})

creates a new MultiHyperbee with two single-writer hypercores: 
- **Store** - a hyperbee into which we will store objects created/changed locally or received from peers. This hyperbee is not replicated to peers. Multi-hyperbee's main goal is to achieve convergence, that is to keep this store in exactly the same state as store on other peers. This can't happen synchronously as peers are not expected to be only all the time, but eventually.
- **Diff** - here we store all changes made locally. Other peers replicate this and merge each diff into their own store.
Options included:
``` js
{
  diffHyperbee, // required - should be hyperbee
  // other options
  opts: { // Same as for Hyperbee
    keyEncoding: 'utf-8' | 'binary' | 'ascii', // or some abstract encoding
    valueEncoding: <same as above>
  },
  customeMergeHandler // CRDT handler to apply changes to the Object
}
```
### db.put(key, storeValue)

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

## db.addHyperbee(replicaHyperbee)

adds replica Hyperbee.

Added Hyperbee should be created using replica key like this: 
``` js
const replicaFeed = hypercore(storage, replicaKey, {...feedOpts, sparse: true})
const replicaHyperbee = new Hyperbee(replicaFeed, hyperbeeOpts)
multi.addHyperbee(replicaHyperbee)
```

## const replicaHyperbee = db.removeHyperbee(replicaKey)

removes replica Hyperbee

## stream = db.createUnionStream(key)

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

### Limitations

**batch** is not yet supported

### Punch list

MH - generate diff for insert/remove to array changes

