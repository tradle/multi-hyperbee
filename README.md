# Multi-writer hyperbee
This repository owes its design to [@RangerMauve](https://github.com/RangerMauve)'s awesome [multi-hyperdrive](https://github.com/RangerMauve/multi-hyperdrive).

## The need
[Hyperbee](https://github.com/mafintosh/hyperbee) is a one of a kind steaming database that will change the way we work with databases. 
But like all other components of hypercore ecosystem it is single-writer. It is not a deficiency, it's just a lower level abstraction. 
We are using it to create a multi-writer database hence the name multi-hyperbee.

### Algorithm
Multi-hyperbee is connecting a primary hyperbee with sparse replicas of peers' hyperbees. 
It updates primary hyperbee with all the changes from its peers' hyperbees so that it always has the full set of fresh data. 
Each peer has exactly the same design. Their own hyperbee as a single-writer and peers' hyperbees as sparse replicas.

Note: Sparse here means only the changes are replicated to peers.

Design of multi-hyperbee follows multi-hyperdrive closely. The difference is that multi-hyperdrive does not aply updates to the primary, and instead it performs checks which file is fresher on the fly, in primary or in all the replicas, and then it reads that one (it also does a clever on the fly merging of directory listing requests). 

The difficulty with the database vs a filesystem is that you need to perform sorted searches. So it is not possible to check which file is fresher and return it.

In our first attempt to follow multi-hyperdrive design we tried to avoid copying the data. We found a way to query the primary hyperbee and all replicas with one sorted union (see [test](https://github.com/tradle/why-hypercore/blob/master/test/hyperbeeUnion.test.js)) It avoids applying edits in primary, and it works. But in our target scenario we might have 6 replicas - iPhone, iPad, Mac, and 3 personal peers in the cloud. So this becomes a 6-way union, which is expensive. It degrades even further, as CRDT merges will need to be performed on the fly across 6 replicas and may accumulate changes from multiple updates. And it will all be thrown away after union stream is closed. 

So instead we apply a change to the primary and bear the cost of duplicating the same data in primary and in replica. Unlike a multi-hyperdrive could not use this approach as it would then replicate big files. Imagine duplicating a 10gb file. But in multi-hyperbee the replica is similar to a replica of file metadata, so costs are ok.

## Use case
Multi-device support. One or more devices are personal cloud peers.

## Cost and future optimizations
Performace of reads equals the one for the hyperbee, and so is the performance of local writes.
Updates coming from replicas are written 2 times, in sparse replica and in primary. So it also doubles storage costs, but it is not doubling the size of the database, only the size of updates made on remote peers. 

We could clear() storage for the KV update on replicam, but need to watch out for:
- atomicity - make sure to only clear() after write to primary fully propagated to the underlying store
- race condition when update from remote happens during clear()

## Merge
At the moment merge is simplistic - the key is updated in primary with the value from the replica. CRDT is coming shortly to do it for real. 

There is a ping-pong loop problem with updating primary. All replicas are notified and update their primaries. Now everyone receives this update again. Apply it. And the cycle of life repeates again. And again. And again :-)

We resolved the ping-pong updates loop issue with setting a '_replica' flag when applying update to a primary. Each peer applying change still pongs it back to all peers, but just once. We hope to find a solution for this later. One benefit of this pong is that each peer will be able to verify that CRDT arrived at the same state across all peers.

## Failure modes
update() event on replica occured and computer died before we applied it to primary. Will it arrive again?

## Usage
```
const MultiHyperbee = require('multi-hyperbee')
const hypercore = require('hypercore')
const Hyperbee = require('hyperbee')

const feedOpts = { value-encoding: 'json' }
const hyperbeeOpts = { keyEncoding: 'utf-8', valueEncoding: 'json' }

const feed = hypercore(storage, feedOpts)
const multiHyperbee = new MultiHyperbee(feed, hyperbeeOpts)

// At some point replica key becomes known and the replica hyperbee can be added to receive updates on it  
const replicaFeed = hypercore(storage, replicaKey, {...feedOpts, sparse: true})
const replicaHyperbee = new Hyperbee(replicaFeed, hyperbeeOpts)

multiHyperbee.addHyperbee(replicaHyperbee)

```

## API
### const db = new MultiHyperbee(primaryFeed, [options])

create a new MultiHyperbee with primary single-writer hypercore. 
Options included are the same as for Hyperbee
```
{
  keyEncoding: 'utf-8' | 'binary' | 'ascii', // or some abstract encoding
  valueEncoding: <same as above>
}
```
## db.addHyperbee(replicaHyperbee)

adds replica Hyperbee.

Added Hyperbee should be created using replica key like this: 
```
const replicaFeed = hypercore(storage, replicaKey, {...feedOpts, sparse: true})
const replicaHyperbee = new Hyperbee(replicaFeed, hyperbeeOpts)
multi.addHyperbee(replicaHyperbee)
```

## const replicaHyperbee = db.removeHyperbee(replicaKey)

removes replica Hyperbee

### the rest of API is the same as Hyperbee

