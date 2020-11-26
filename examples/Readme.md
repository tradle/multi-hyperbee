### To run this example
 - open 2 or more tabs in the terminal
 - in each of them run command 
```
 node examples/example.js -s [some storage name]
```
 using different storage name for different tabs. It will create directory structure for MultiHyperbee and print the **key** of the Diff Hyperbee.
 - run command 
 ```
 node examples/example.js -s [some storage name] -k [array of the keys of the Diff Hyperbees from other tabs]
 ```
You can then enter some data (since the example uses stdin) and it'll create the object(s) from the entered data which are going to be replicated.

You can check the replication results in **data** files in the directory structure
 
 
