# Default Merge Handler

All the calls to Merge Handler are done by MultiHyperbee. Which means that if you write your own Merge Handler, it is need to be passed as a parameter to MultiHyperbee like this:

```
const multihyperbee = new MultiHyperbee(s, [options], customMergeHandler)
```

## API

#### `const mergeHandle = new MergeHandler(store)`
Creates an instance of the Merge Handler for a particular multiHyperbee.
`store` is a MultiHyperbee instance

#### `merge(diff)`
Finds the object corresponding to **__objectId** in **diff** object and performs the merge. Algorithm below

#### `const diffObject = genDiff(oldValue, newValue)`
Generates **diff** object when multi-hyperbee **put** is called and no **_diff** object was passed with the **store** object

## Algorithm for the default Merge Handler

1. find the last version of the **store** object corresponding to the **diff** by _objectId.
2. if the timestamp of the **diff** object is bigger than the one of the **store** object
    - merge the **diff** to the **store** object
3. Otherwise:
    - find all the **diff** objects on all the peers from the **diff** object timestamp
    - finds the version of the store **object** with the same timestamp as **diff** object
    - merge all found **diff(s)** to the found **store** object
    - creates new **store** objects with each applied **diff**

This creates a fork from the previous sequence of changes of the store objects

## Diff object schema

``` js
  const diffSchema = {
    _timestamp: 'string',
    obj: {
      _objectId: 'string',
      _prevTimestamp: 'string'
    },
    list: {
      add: {
        // value of the property can be primitive JSON types or JSON object or any arrays
        property: 'any type',
      },
      remove: {
        // value of the property can be any string but it's value is not used in any way
        property: ''
      },
      insert: {
        // could be insert in some value like object or array,
        // otherwise will work the same way as add on top level
        add: {
          property: 'object',
          // ARRAY
          property: [
            {
              before: 'some value in array',
              after: 'some value in array',
              index: 'number'
            }
          ]
        },
        remove: {
          property: 'JSON object or Array'
        }
      }
    }
  }
```

