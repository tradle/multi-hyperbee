const test = require('tape')
const MultiHyperbee = require('../')
const hyperswarm = require('hyperswarm')
const crypto = require('crypto')
const pump = require('pump')
const rmdir = require('rimraf')
const log = require('why-is-node-running')
const { checkForPeers, checkStoreAndDiff, setup, delay } = require('./helpers')
const { object0, object1, object1_1, object2,
        diff0, diff1, diff1_1, diff2 } = require('./constants')

const topicHex = crypto.createHash('sha256')
  .update('my-multi-hyperbee')
  .digest()

var swarms = []

test('Multihyperbee - connected via hyperswarm', async t => {
  let storage = './test/mht/'
  let { multiHBs } = await setup(3, storage)
  let streams = []
  for (let i=0; i<multiHBs.length; i++) {
    let cur = i
    let j = 0
    let multiHB = multiHBs[i]
    let diffFeed = (await multiHB.getDiff()).feed
    for (; j<multiHBs.length; j++) {
      if (j === cur) continue
      await multiHBs[j].addPeer(diffFeed.key)
    }
  }
  const [ one, two, three ] = multiHBs
  let swarms = []
  for (let i=0; i<multiHBs.length; i++) {
    swarms.push(startSwarm(multiHBs[i], i))
  }

  let objects = [object0, object1, object2].map((obj, i) => {
    let _objectId = `Contact/r${i}`
    return {...obj, _objectId, someField: Math.random()}
  })
  for (let i=0; i<multiHBs.length; i++) {
    await multiHBs[i].put(objects[i]._objectId, objects[i])
  }

  await delay(2000)
  for (let i=0; i<multiHBs.length; i++) {
    let entries = await logFeed(multiHBs[i], i)
    let cmpObj = objects.slice()
    entries.forEach(entry => {
      const { key, value } = entry[`Peer ${i}`]
      if (key === '__peers')
        return
      delete value._prevSeq
      delete cmpObj[0]._prevSeq
      t.same(value, cmpObj[0])
      cmpObj.shift()
      // console.log(entry)
    })
  }
  // setTimeout(log, 1000)
  await delay(2000)
  // t.pass('done with test')
  t.end()
})
test('Multihyperbee - connected via hyperswarm - create object with the same key on 2 devices', async t => {
  let storage = './test/mht2/'
  let { multiHBs } = await setup(2, storage)
  let streams = []
  for (let i=0; i<multiHBs.length; i++) {
    let cur = i
    let j = 0
    let multiHB = multiHBs[i]
    let diffFeed = (await multiHB.getDiff()).feed
    for (; j<multiHBs.length; j++) {
      if (j === cur) continue
      await multiHBs[j].addPeer(diffFeed.key)
    }
  }
  const [ one, two ] = multiHBs
  let swarms = []
  for (let i=0; i<multiHBs.length; i++) {
    swarms.push(startSwarm(multiHBs[i], i))
  }

  for (let i=0; i<multiHBs.length; i++) {
    await multiHBs[i].put('sameKey', object0)
    await delay(1000)
  }
  delete object0._prevSeq
  await delay(2000)
  for (let i=0; i<multiHBs.length; i++) {
    let entries = await logFeed(multiHBs[i], i)
    entries.forEach(entry => {
      const { key, value } = entry[`Peer ${i}`]
      if (key === '__peers')
        return

      delete value._prevSeq
      t.same(value, object0)
    })
  }
  await delay(2000)
  // t.pass('done with test 2')
  t.end()
})

test.onFinish(async () => {
  await delay(2000)
  swarms.forEach(swarm => swarm.destroy())
})
function startSwarm(db, i) {
  var swarm = hyperswarm()
  swarm.join(topicHex, {
    lookup: true,
    announce: true
  })
  swarms.push(swarm)
  swarm.on('connection', async (socket, info) => {
    // const key = db.feed.key.toString('hex')
    // socket.write(key)
    // socket.once('data', function (id) {
    //   // debugger
    //   info.deduplicate(Buffer.from(key), id)
    // })
    let stream = await db.replicate(info.client, {stream: socket, live: true})
    pump(socket, stream, socket)
  })
  return swarm
}
async function logFeed(db, i) {
  // console.log('watching', feed.key.toString('hex'), feed.length)
  let stream = db.createReadStream({ live: true })
  return await collect(stream, i)
}
async function collect(stream, i) {
  return new Promise((resolve, reject) => {
    const entries = []
    stream.on('data', d => entries.push({[`Peer ${i}`]: d}))
    stream.on('end', () => resolve(entries))
    stream.on('error', err => reject(err))
    stream.on('close', () => reject(new Error('Premature close')))
  })
}

