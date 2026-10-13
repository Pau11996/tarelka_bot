const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateRecipePortion } = require('../public/recipe-calculator.js');

test('the worked recipe uses cooked weight and postpones rounding', () => {
    const result = calculateRecipePortion(1005, 900, 250);
    assert.equal(Math.round(result.per100), 112);
    assert.equal(Math.round(result.portion), 279);
    assert.equal(Math.round(calculateRecipePortion(1005, 900, 200).portion), 223);
});
test('handles whole recipes, fractional grams and zero-energy dishes', () => {
    assert.deepEqual(calculateRecipePortion(400, 200, 200), { per100: 200, portion: 400 });
    assert.deepEqual(calculateRecipePortion(90, 10, 2.5), { per100: 900, portion: 22.5 });
    assert.deepEqual(calculateRecipePortion(0, 200, 100), { per100: 0, portion: 0 });
});
test('rejects impossible, missing and non-finite inputs instead of returning misleading totals', () => {
    for (const input of [[-1,200,100],[400,0,100],[400,200,0],[400,200,201],
        [NaN,200,100],[400,Infinity,100],[400,200,NaN],[1e7,200,100]]) {
        assert.throws(() => calculateRecipePortion(...input), RangeError);
    }
});
