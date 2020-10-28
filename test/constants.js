module.exports = {
  contactSchema: {
    firstName: 'string',
    lastName: 'string',
    dateOfBirth: 'date',
    gender: 'string',
    country: {
      name: 'string',
      code: 'string'
    },
    friends: 'array'
  },
  diffSchema: {
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
    },
    obj: {
      _objectId: 'string',
      _prevTimestamp: 'string'
    },
    timestamp: 'string'
  },

  object0: {
    _objectId: 'Contact/r1',
    firstName: 'J',
    lastName: 'S',
    friends: ['Claire', 'Martha', 'Jake', 'Sean']
  },

  diff0: {
    obj: {
      _objectId: 'Contact/r1'
    },
    list: {
      add: {
        firstName: 'J',
        lastName: 'S',
        friends: ['Claire', 'Martha', 'Jake', 'Sean']
      }
    }
  },
  object1: {
    _objectId: 'Contact/r1',
    firstName: 'Jane',
    lastName: 'Smith',
    gender: 'F',
    friends: ['Claire', 'Martha', 'Jake', 'Sean'],
    country: {
      name: 'United States'
    }
  },
  diff1: {
    obj: {
      _objectId: 'Contact/r1'
    },
    list: {
      add: {
        lastName: 'Smith',
        gender: 'F',
        firstName: 'Jane',
        country: {
          name: 'United States'
        }
      }
    }
  },
  object1_1: {
    _objectId: 'Contact/r1',
    firstName: 'Jane',
    lastName: 'Smith',
    gender: 'F',
    country: {
      name: 'United States',
      code: 'US'
    },
    nickname: 'Jenny',
    friends: ['Claire', 'Kate', 'Martha', 'Maggie', 'Jake', 'Sean']
  },
  diff1_1: {
    obj: {
      _objectId: 'Contact/r1'
    },
    list: {
      add: {
        nickname: 'Jenny'
      },
      insert: {
        add: {
          friends: [
            {after: 'Claire', value: 'Kate'},
            {after: 'Martha', value: 'Maggie'}
          ],
          country: {
            code: 'US'
          }
        }
      }
    }
  },

  object2: {
    _objectId: 'Contact/r1',
    firstName: 'Jane',
    lastName: 'Smith',
    nickname: 'Jenny',
    friends: ['Claire', 'Kate', 'Martha', 'Maggie', 'Jake'],
    country: {
      name: 'United States'
    },
    dateOfBirth: 843177600000 //'1996-09-20'
  },
  diff2: {
    obj: {
      _objectId: 'Contact/r1'
    },
    list: {
      add: {
        dateOfBirth: 843177600000 //'1996-09-20'
      },
      remove: {
        gender: ''
      },
      insert: {
        remove: {
          country: {
            code: 'US'
          },
          friends: [
            {value: 'Sean'}
          ]
        }
      }
    }
  }
}