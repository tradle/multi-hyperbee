const Automerge = require('automerge')
const isEqual = require('lodash/isEqual')
const extend = require('lodash/extend')
const size = require('lodash/size')

// MergeHandler must use store._put to notify MultiHyperbee that it does not need to
// generate diff object in this case

module.exports = async function mergeHandler (store, diff) {
  let { obj, list, _timestamp } = diff

  let { _objectId: rkey, _prevTimestamp } = obj

  // let rkey = _objectId
  let prevResource = await store.get(rkey)

  prevResource = prevResource  &&  prevResource.value
  let isNew = !prevResource  &&  !_prevTimestamp

  if (!isNew  &&  !prevResource) {
    debugger
    return
  }

  if (isNew  ||  prevResource._timestamp === _prevTimestamp) {
    const val = merge(prevResource, diff, isNew)
    if (prevResource  &&  isEqual(val, prevResource)) {
      debugger
      return
    }
    await store._put(rkey, val)
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
  let unionStream = store.createUnionStream(ukey)

  let entries
  try {
    entries = await collect(unionStream)
  } catch (err) {
    console.log(`Error updating with ${JSON.stringify(diff, null, 2)}`, err)
    return
  }
  if (needEarlierObject) {
    debugger
    let objTimestamp = entries[0].value()._timestamp

    let hist = store.createHistoryStream({gte: rkey, lte: rkey})
    let objects = await collect(hist)
    let vobj = objects.find(obj => obj.value._timestamp === objTimestamp)
    prevResource = vobj.value
  }

  entries = entries.map(e => e.value)
  entries.push(diff)
  entries.sort((a, b) => new Date(a._timestamp).getTime() - new Date(b._timestamp).getTime())

  for (let i=0; i<entries.length; i++) {
    let value = entries[i]
    let updatedValue = merge(prevResource, value)
    if (prevResource  &&  isEqual(updatedValue, prevResource)) {
      debugger
      return
    }
    await store._put(rkey, updatedValue)
    prevResource = updatedValue
  }
}

async function collect(stream) {
  return new Promise((resolve, reject) => {
    const entries = []
    stream.on('data', d => entries.push(d))
    stream.on('end', () => resolve(entries))
    stream.on('error', err => reject(err))
    stream.on('close', () => reject(new Error('Premature close')))
  })
}
function merge(resource, diff, isNew) {
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
        handleInsert({ to: doc[prop], value: actionProps[prop], isAdd: action === 'add' })
    }
  })

  return JSON.parse(JSON.stringify(updatedDoc))
}
function handleInsert({ to, value, isAdd }) {
  if (!Array.isArray(value)) {
    if (typeof value === 'object') {
      if (isAdd)
        extend(to, value)
      else
        deleteFrom(to, value)
    }
    else if (isAdd)
      to = value
    else
      delete to
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
function deleteFrom(from, obj) {
  for (let p in obj) {
    if (typeof obj[p] !== 'object') {
      delete from[p]
    }
    else if (!size(obj[p]))
      delete from[p]
    else
      deleteFrom(from[p], obj[p])
  }
}

