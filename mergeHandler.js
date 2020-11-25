const Automerge = require('automerge')
const isEqual = require('lodash/isEqual')
const extend = require('lodash/extend')
const size = require('lodash/size')

// MergeHandler must use store._put to notify MultiHyperbee that it does not need to
// generate diff object in this case

class MergeHandler {
  constructor(store) {
    this.store = store
  }
  async merge (diff) {
    let { obj, list, _timestamp } = diff

    let { _objectId: rkey, _prevTimestamp } = obj

    // let rkey = _objectId
    let prevResource = await this.store.get(rkey)

    prevResource = prevResource  &&  prevResource.value
    let isNew = !prevResource  &&  !_prevTimestamp

    if (!isNew  &&  !prevResource) {
      debugger
      return
    }

    if (isNew  ||  prevResource._timestamp === _prevTimestamp) {
      const val = this._doMerge(prevResource, diff, isNew)
      if (prevResource  &&  isEqual(val, prevResource)) {
        debugger
        return
      }
      await this.store._put(rkey, val)
      return
    }
    let query

    let tm, needEarlierObject
    if (prevResource._timestamp < _timestamp)
      tm = prevResource._timestamp
    else {
      tm = _timestamp
      needEarlierObject = true
    }
    let ukey = `${rkey}/${tm}`
    let unionStream = this.store.createUnionStream(ukey)

    let entries
    try {
      entries = await this.collect(unionStream)
    } catch (err) {
      console.log(`Error updating with ${JSON.stringify(diff, null, 2)}`, err)
      return
    }
    if (needEarlierObject) {
      debugger
      let objTimestamp = entries[0].value()._timestamp

      let hist = this.store.createHistoryStream({gte: rkey, lte: rkey})
      let objects = await this.collect(hist)
      let vobj = objects.find(obj => obj.value._timestamp === objTimestamp)
      prevResource = vobj.value
    }

    entries = entries.map(e => e.value)
    entries.push(diff)
    entries.sort((a, b) => new Date(a._timestamp).getTime() - new Date(b._timestamp).getTime())

    for (let i=0; i<entries.length; i++) {
      let value = entries[i]
      let updatedValue = this._doMerge(prevResource, value)
      if (prevResource  &&  isEqual(updatedValue, prevResource)) {
        debugger
        return
      }
      await this.store._put(rkey, updatedValue)
      prevResource = updatedValue
    }
  }

  /*
  Generates diff object according to diffSchema
   */
  genDiff(newValue, oldValue) {
    if (!oldValue)
      oldValue = {}
    let add = {}
    let insert = {}
    let remove = {}

    for (let p in newValue) {
      if (p.charAt(0) === '_')
        continue
      let oldVal = oldValue[p]
      let newVal = newValue[p]
      delete oldValue[p]

      if (!oldVal) {
        add[p] = newVal
        continue
      }

      if (oldVal === newVal  || (typeof oldVal === 'object' && isEqual(oldVal, newVal)))
        continue
      if (Array.isArray(oldVal)) {
        this._insertArray(insert, p, newVal, oldVal)
        continue
      }
      if (typeof oldVal === 'object') {
        this._insertObject(insert, p, newVal, oldVal)
        continue
      }
      add[p] = newVal
    }
    for (let p in oldValue) {
      if (p.charAt(0) === '_')
        continue
      remove[p] = ''
    }
    let list = {}
    if (size(add))
      list.add = add
    if (size(remove))
      list.remove = remove
    if (size(insert))
      list.insert = insert
    let diff = {
      _timestamp: newValue._timestamp,
      obj: {
        _objectId: newValue._objectId
      },
      list
    }
    if (newValue._prevTimestamp)
      diff.obj._prevTimestamp = newValue._prevTimestamp
    return diff
  }
  _insertObject(insert, p, newVal, oldVal) {
    let result = this._diff(oldVal, newVal)
    for (let pp in result) {
      if (typeof result[pp] === 'undefined') {
        if (!insert.remove)
          insert.remove = {}
        if (!insert.remove[p])
          insert.remove[p] = {}

        extend(insert.remove[p], {
          [pp]: oldVal[pp]
        })
      }
      else {
        if (!insert.add) {
          insert.add = {}
          insert.add[p] = {}
        }
        insert.add[p] = {
          ... insert.add[p],
          [pp]: newVal[pp]
        }
      }
    }
  }
  _insertArray(insert, prop, newVal, oldVal) {
    let newVal1 = newVal.slice()
    for (let i=0; i<oldVal.length; i++) {
      let idx = newVal1.indexOf(oldVal[i])
      if (idx !== -1) {
        newVal1.splice(idx, 1)
        continue
      }
      if (!insert.remove)
        insert.remove = {}
      if (!insert.remove[prop])
        insert.remove[prop] = [{value: oldVal[i]}]
    }
    if (newVal1.length) {
      if (!insert.add)
        insert.add = {}
      insert.add = []
      newVal1.forEach(value => {
        let idx = newVal.indexOf(value)
        insert.add.push({after: newVal[idx - 1], value})
      })
    }
  }

  _diff(obj1, obj2) {
    const result = {};
    if (Object.is(obj1, obj2))
      return result

    if (!obj2 || typeof obj2 !== 'object')
      return obj2

    Object.keys(obj1 || {}).concat(Object.keys(obj2 || {})).forEach(key => {
      if(obj2[key] !== obj1[key] && !Object.is(obj1[key], obj2[key]))
        result[key] = obj2[key]

      if(typeof obj2[key] === 'object' && typeof obj1[key] === 'object') {
        const value = this._diff(obj1[key], obj2[key]);
        if (value !== undefined)
          result[key] = value;
      }
    })
    return result;
  }

  async collect(stream) {
    return new Promise((resolve, reject) => {
      const entries = []
      stream.on('data', d => entries.push(d))
      stream.on('end', () => resolve(entries))
      stream.on('error', err => reject(err))
      stream.on('close', () => reject(new Error('Premature close')))
    })
  }
  _doMerge(resource, diff, isNew) {
    if (isNew)
      resource = diff.obj

    let { _timestamp, obj, list } = diff

    let { _objectId, seq, _t } = obj
    let { add={}, remove={}, insert={} } = list

    let doc = Automerge.from(resource)
    let updatedDoc = Automerge.change(doc, doc => {
      doc._timestamp = _timestamp
      for (let p in remove)
        delete doc[p]

      for (let p in add) {
        let value = add[p]
        let oldValue = doc[p]
        if (!oldValue || (typeof value !== 'object')) {
          doc[p] = value
          continue
        }
        if (!Array.isArray(value)) {
          doc[p] = value
          continue
        }
        for (let i=0; i<value.length; i++) {
          let elm = value[i]
          let oldIdx = oldValue.findIndex(oelm => {
            if (typeof elm === 'object')
              return deepEquals(elm, oelm)
            return elm === oelm
          })
          // let oldIdx = oldValue.findIndex(oelm => elm === oelm)
          if (oldIdx === -1)
            doc[p].splice(i, 0, elm)
        }
      }
      for (let action in insert) {
        let actionProps = insert[action]
        for (let prop in actionProps)
          this.handleInsert({ prop, doc, value: actionProps[prop], isAdd: action === 'add' })
      }
    })

    return JSON.parse(JSON.stringify(updatedDoc))
  }
  handleInsert({ prop, doc, value, isAdd }) {
    let to = doc[prop]
    if (!Array.isArray(value)) {
      if (typeof value === 'object') {
        if (isAdd)
          extend(to, value)
        else
          this.deleteFrom(to, value)
      }
      else if (isAdd)
        to = value
      else
        delete to[prop]
      return
    }
    // debugger
    value.forEach(({index, before, after, value}) => {
      if (before)
        index = to.indexOf(before)
      else if (after) {
        index = to.indexOf(after)
        if (index !== -1)
          index++
      }
      if (isAdd) {
        if (!index  ||  index === -1)
          to.push(value)
        else
          to.insertAt(index, value)
      }
      else {
        if (!index)
          index = to.indexOf(value)
        if (index !== -1)
          to.deleteAt(index)
      }
    })
  }
  deleteFrom(from, obj) {
    for (let p in obj) {
      if (typeof obj[p] !== 'object') {
        delete from[p]
      }
      else if (!size(obj[p]))
        delete from[p]
      else
        this.deleteFrom(from[p], obj[p])
    }
  }
}
module.exports = MergeHandler

