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
