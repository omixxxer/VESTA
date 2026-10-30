import { describe, expect, it } from 'vitest'
import { ctcDecode, detectTextBoxes } from './textReader'

const settings = { threshold: 0.3, boxThreshold: 0.6, unclipRatio: 1.5 }

function map(width: number, height: number, regions: Array<[number, number, number, number, number]>) {
  const probabilities = new Float32Array(width * height)
  for (const [left, top, right, bottom, value] of regions) {
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) probabilities[y * width + x] = value
    }
  }
  return probabilities
}

describe('text detection post-processing', () => {
  it('turns confident regions into boxes grown around the word core', () => {
    const boxes = detectTextBoxes(map(40, 20, [[10, 5, 30, 10, 0.9]]), 40, 20, settings)
    expect(boxes).toHaveLength(1)
    const [box] = boxes
    // A 20×5 core grows by 20·5·1.5 / (2·25) = 3 px on every side.
    expect(box).toMatchObject({ left: 7, top: 2, right: 33, bottom: 13 })
    expect(box!.score).toBeCloseTo(0.9)
  })

  it('drops faint regions and specks', () => {
    const probabilities = map(40, 20, [[2, 2, 12, 8, 0.4], [20, 10, 22, 12, 0.95]])
    expect(detectTextBoxes(probabilities, 40, 20, settings)).toEqual([])
  })

  it('keeps separate words apart', () => {
    const probabilities = map(60, 20, [[2, 5, 20, 10, 0.9], [30, 5, 55, 10, 0.8]])
    expect(detectTextBoxes(probabilities, 60, 20, settings)).toHaveLength(2)
  })
})

describe('CTC decoding', () => {
  it('merges repeats, drops blanks and averages the confidence', () => {
    const characters = ['N', 'I', 'K', 'E']
    // Steps: N N blank I K K E (class 0 is the blank, class i is characters[i - 1]).
    const best = [1, 1, 0, 2, 3, 3, 4]
    const logits = best.flatMap((winner) => [0, 1, 2, 3, 4].map((index) => (index === winner ? 0.9 : 0.025)))
    const decoded = ctcDecode(logits, best.length, 5, characters)
    expect(decoded.text).toBe('NIKE')
    expect(decoded.score).toBeCloseTo(0.9)
  })

  it('keeps a doubled letter separated by a blank', () => {
    const best = [1, 0, 1]
    const logits = best.flatMap((winner) => [0, 1].map((index) => (index === winner ? 1 : 0)))
    expect(ctcDecode(logits, best.length, 2, ['O']).text).toBe('OO')
  })
})
