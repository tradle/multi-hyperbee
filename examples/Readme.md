### To run this example
 - open 2 or more tabs in the terminal
 - in each of them run command 
```
 node examples/example.js -s [some storage name]
```
 using different storage name for different tabs. It will create directory structure for MultiHyperbee and print the **key** of the Diff Hyperbee.
 - run command 
 ```
 node examples/example.js -s [some storage name] -k [array of the keys of the Diff Hyperbees from other tabs. Use comma as a delimiter]
 ```
 
For example if you want to test for 3 devices:
- Open 3 terminals
- On the first run you got all 3 keys key1, key2, key3. 
- To run this example for the key1 as the main key, the command will be
```
 node examples/example.js -s [key1 storage name] -k key2,key3
```
You can then enter some data (since the example uses stdin) and it'll create the object(s) from the entered data which are going to be replicated.

You can check the replication results in **data** files in the directory structure
 
 
