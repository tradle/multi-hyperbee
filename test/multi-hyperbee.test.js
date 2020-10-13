const test = require('tape')
const Hyperbee = require('hyperbee')
const { promisifyAndExec, create, createOne } = require('./helpers')
const MultiHyperbee = require('../')

const OPTIONS = {
        keyEncoding: 'utf-8',
        valueEncoding: 'json'
      }

test('Multihyperbee', async t => {
  const [primaryFeed, secondaryFeed] = await create({count: 2})

  const primary = new MultiHyperbee(primaryFeed, {...OPTIONS, name: 'primary'})
  let pkey = primaryFeed.key

  const cloneFeedOptions = {valueEncoding: 'json', sparse: true}

  const clonePrimaryFeed = await createOne(pkey, cloneFeedOptions)
  await promisifyAndExec(clonePrimaryFeed, 'ready')
  const clonePrimaryHB = new Hyperbee(clonePrimaryFeed, OPTIONS)

  const secondary = new MultiHyperbee(secondaryFeed, {...OPTIONS, name: 'secondary'})
  let skey = secondaryFeed.key
  let cloneSecondaryFeed = await createOne(skey, cloneFeedOptions)
  await promisifyAndExec(cloneSecondaryFeed, 'ready')

  const cloneSecondaryHB = new Hyperbee(cloneSecondaryFeed, OPTIONS)

  primary.addHyperbee(cloneSecondaryHB)
  secondary.addHyperbee(clonePrimaryHB)

  let stream = secondaryFeed.replicate(false, {live: true})
  stream.pipe(cloneSecondaryFeed.replicate(true, {live: true})).pipe(stream)


  let pstream = primaryFeed.replicate(false, {live: true})
  pstream.pipe(clonePrimaryFeed.replicate(true, {live: true})).pipe(pstream)

  await primary.put('a', {})
  await secondary.put('b', {})
  await secondary.put('c', {})
  await secondary.put('d', {})

  secondary.put('a', {s: 1})
  let toVal = [
    {key: 'b', value: {}},
    {key: 'c', value: {}},
    {key: 'd', value: {}},
    {key: 'a', value: {}}
  ]
  let secCounter = toVal.length
  let prCounter = toVal.length

  let sec = secondary.createReadStream()
  await new Promise((resolve, reject) => {
    sec.on('data', (data) => {
      console.log(data)
      delete data.seq
      delete data.value._replica
      let idx = toVal.findIndex(e => e.key === data.key)
      t.same(data, toVal[idx])
      secCounter--
    })
    sec.on('end', (data) => {
      resolve()
    })
  })
  let ps = primary.createReadStream()
  await new Promise((resolve, reject) => {
    ps.on('data', (data) => {
      console.log(data)
      delete data.seq
      delete data.value._replica
      let idx = toVal.findIndex(e => e.key === data.key)
      t.same(data, toVal[idx])
      prCounter--
    })
    ps.on('end', (data) => {
      resolve()
    })
  })
  if (prCounter  ||  secCounter)
    t.fail()
  t.end()
})
