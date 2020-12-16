const Automerge = require('automerge')
const { cloneDeep, size, extend, isEqual } = require('lodash')

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
    let prevObject = await this.store.get(rkey)

    prevObject = prevObject  &&  prevObject.value
    // Not working when there is no object but there is _prevTimestamp
    let isNewHere = !prevObject // &&  !_prevTimestamp
    let isNewThere = !_prevTimestamp

    if ((isNewHere && isNewThere) ||  (prevObject  &&  prevObject._timestamp === _prevTimestamp)) {
      const val = this._doMerge(prevObject, diff, isNewHere)
      if (prevObject  &&  isEqual(val, prevObject)) {
        debugger
        return
      }
      await this.store._put(rkey, val)
// console.log('New object: ' + JSON.stringify(val, null, 2))
      return
    }
    let { tm, needEarlierObject } = this.getTimestampForUpdateQuery(prevObject, diff)

    let ukey = `${rkey}/${tm}`
    let unionStream = this.store.createUnionStream(ukey)

    let entries
    try {
      entries = await this.collect(unionStream)
    } catch (err) {
      console.log(`Error updating with ${JSON.stringify(diff, null, 2)}`, err)
      return
    }
    let origPrevObject
    if (needEarlierObject) {
      if (!entries.length) {
        await this.handleEarlierObject(entries, prevObject, diff)
        return
      }
      origPrevObject = prevObject
      prevObject = await this.findStartingObject(prevObject, entries)
    }

    entries = entries.map(e => e.value)
    let idx = entries.find(e => e._timestamp === diff._timestamp)
    if (idx === -1)
      entries.push(diff)
    entries.sort((a, b) => this.getTime(a._timestamp) - this.getTime(b._timestamp))

    for (let i=0; i<entries.length; i++) {
      let value = entries[i]
      let updatedValue = this._doMerge(prevObject, value)
      if (prevObject  &&  isEqual(updatedValue, prevObject)) {
        debugger
        // continue
      }
// console.log('Updated object: ' + JSON.stringify(updatedValue, null, 2))
      await this.store._put(rkey, updatedValue)
      prevObject = updatedValue
    }
  }
  getTime(timestamp) {
    let idx = timestamp.length - 5
    return new Date(timestamp.slice(0, idx)).getTime()
  }
  getTimestampForUpdateQuery(prevObject, diff) {
    let { _timestamp, obj } = diff
    let { _prevTimestamp } = obj

    if (!prevObject)
      return { tm: '' }
    // Diff for update
    if (_prevTimestamp) {
      if (prevObject._timestamp < _prevTimestamp)
        return { tm: prevObject._timestamp }
      if (prevObject._prevTimestamp  &&  prevObject._prevTimestamp === _prevTimestamp) {
        if (prevObject._timestamp < _timestamp)
          return { tm: _prevTimestamp }

        let needEarlierObject = true
        if (_timestamp < prevObject._prevTimestamp)
          return { tm: _timestamp, needEarlierObject }
        return { tm: _prevTimestamp, needEarlierObject }
      }
      else
        return { tm: _prevTimestamp }
    }
    // Diff for creating a new Object
    if (prevObject._timestamp < _timestamp)
      return { tm: prevObject._timestamp }

    let needEarlierObject = true
    if (_timestamp < prevObject._prevTimestamp)
      return { tm: _timestamp, needEarlierObject }
    return { tm: _prevTimestamp, needEarlierObject }
  }
  async findStartingObject(prevObject, entries) {
    let { value } = entries[0]
    let entryTimestamp = value.obj._prevTimestamp || value._timestamp
    while (true) {
      let prevSeq = prevObject._prevSeq
      if (!prevSeq)
        break
      let hist = this.store.createHistoryStream({gte: prevSeq, lte: prevSeq})
      let objects = await this.collect(hist)
      if (!objects.length) {
        debugger
        break
      }
      let objTimestamp = objects[0].value._timestamp
      prevObject = objects[0].value
      if (objTimestamp === entryTimestamp)
        break

      if (objTimestamp > entryTimestamp)
        continue
      else {
        debugger
        break
      }
    }
    return prevObject
  }
  async handleEarlierObject(entries, prevObject, diff) {
    debugger

    let { _objectId: rkey, _prevTimestamp } = diff.obj
    let isNewThere = !_prevTimestamp
    if (prevObject) {
      if (isNewThere) {
        const newThere = this._doMerge(null, diff, true)
        await this.store._put(rkey, newThere, true)
        const pdiff = this.genDiff(prevObject, newThere)
        const updatedValue = this._doMerge(newThere, pdiff)
        await this.store._put(rkey, updatedValue)
        return
      }
      debugger
      return
    }
    if (isNewThere) {
      debugger
      // create object from the received diff
      const val = this._doMerge(prevObject, diff, true)
      await this.store._put(rkey, val)
      return
    }
    debugger
    throw new Error('This should not have happen')
  }

  /*
  Generates diff object according to diffSchema
   */
  genDiff(newV, oldV) {
    let oldValue = oldV ? cloneDeep(oldV) : {}
    let newValue = newV
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
      stream.on('data', d => {
        entries.push(d)
      })
      stream.on('end', () => {
        resolve(entries)
      })
      stream.on('error', err => {
        reject(err)
      })
      stream.on('close', () => {
        reject(new Error('Premature close'))
      })
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

/*
  getTimestampForUpdateQuery(prevObject, diff) {
    let { obj, _timestamp } = diff
    let { _prevTimestamp } = obj

    if (!prevObject)
      return { timestamp: '' }
    // Diff for update
    let needEarlierObject = true
    if (_prevTimestamp) {
      if (prevObject._timestamp < _prevTimestamp)
        return { timestamp: prevObject._timestamp }
      // prevObject is a new Object here, so get all diffs
      if (!prevObject._prevTimestamp)
        return { timestamp: '', needEarlierObject }

      if (prevObject._prevTimestamp > _prevTimestamp)
        return { timestamp: _prevTimestamp, needEarlierObject }

      if (prevObject._prevTimestamp < _prevTimestamp)
        return { timestamp: prevObject._prevTimestamp }

      if (prevObject._prevTimestamp === _prevTimestamp) {
        if (prevObject._timestamp > _timestamp)
          return { timestamp: _prevTimestamp, needEarlierObject }
        else
          return { timestamp: _prevTimestamp }
      }
      else
        return { timestamp: _prevTimestamp, needEarlierObject }
    }
    // Diff for creating a new Object
    if (prevObject._timestamp < _timestamp)
      return { timestamp: prevObject._timestamp }
    else
      return { timestamp: _timestamp, needEarlierObject }
  }

 */