# multi-hyperbee
Multi-writer hyperbee
This repository owes its design to [@RangerMauve](https://github.com/RangerMauve)'s awesome [multi-hyperdrive](https://github.com/RangerMauve/multi-hyperdrive).

## The need
[Hyperbee](https://github.com/mafintosh/hyperbee) is a one of a kind steaming database that will change the way we work with databases. 
But like all other components of hypercore ecosystem it is single-writer. It is not a deficiency, it's just a lower level abstraction. 
We are using it to create a multi writer database hence the name multi-hyperbee.

### Algorithm
Multi-hyperbee is connecting a primary hyperbee with sparse replicas of peers' hyperbees. 
It is written with the purpose to update primary hyperbee with all the changes from its peers' hyperbees so that it always has the full set of fresh data. 
Each peer has exactly the same design. Their own hyperbee as a single-writer and peers hyperbees as sparse replicas.

Note: Sparse here means only changes are replicated

## Use case
Multi-device support. One or more devices are personal cloud peers.

## Cost
Performace of reads equals the one for the hyperbee, and so is the performance of local writes.
Updates coming from replicas are written 2 times, in sparse replica and in primary. So it also doubles storage costs, but it is not doubling the size of the database, only the size of updates made on remote peers.

## Merge
At the moment merge is simplistic - the key is updated in primary with the value from the replica. CRDT is coming shortly to do it for real. 

There is a ping-pong loop problem with updating primary. All replicas are notified and update their primaries. Now everyone receives this update again. Apply it. And the cycle of life repeates again. And again. And again :-)

We resolved the ping-pong updates loop issue with setting a '_replica' flag when applying update to a primary. Each peer applying change still pongs it back to all peers, but just once. We hope to find a solution for this later. One benefit of this pong is that each peer will be able to verify that CRDT arrived at the same state across all peers.
