module.exports = {
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