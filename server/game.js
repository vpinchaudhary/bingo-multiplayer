'use strict';

/**
 * Pure game logic for house-style Bingo.
 *
 * Rules:
 *  - Each player has a 5x5 grid filled with the numbers 1..25 in random order.
 *  - Players take turns calling an un-called number 1..25.
 *  - Everyone marks the called number on their own grid.
 *  - A "line" is any fully-marked row, column, or main diagonal (12 possible).
 *  - The first player to complete 5 lines spells B-I-N-G-O and wins.
 *  - If more than one player reaches 5 lines on the same call, it is a draw.
 *
 * Everything in this module is deterministic given its inputs (the only
 * randomness is the shuffle, which accepts an injectable RNG for testing).
 */

const GRID_SIZE = 5;
const TOTAL_CELLS = GRID_SIZE * GRID_SIZE; // 25
const LINES_TO_WIN = 5; // B-I-N-G-O
const BINGO = ['B', 'I', 'N', 'G', 'O'];

/**
 * Fisher-Yates shuffle of 1..25 into a 5x5 grid.
 * @param {() => number} rng - returns a float in [0, 1). Defaults to Math.random.
 * @returns {number[][]} 5x5 grid of unique numbers 1..25
 */
function generateGrid(rng = Math.random) {
  const nums = [];
  for (let n = 1; n <= TOTAL_CELLS; n++) nums.push(n);
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  const grid = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    grid.push(nums.slice(r * GRID_SIZE, r * GRID_SIZE + GRID_SIZE));
  }
  return grid;
}

/**
 * Count completed lines for a grid given the set of called numbers.
 * A cell counts as marked when its number has been called.
 * @param {number[][]} grid
 * @param {Set<number>} calledSet
 * @returns {number} number of completed lines (0..12)
 */
function countLines(grid, calledSet) {
  const marked = (r, c) => calledSet.has(grid[r][c]);
  let lines = 0;

  // Rows
  for (let r = 0; r < GRID_SIZE; r++) {
    let all = true;
    for (let c = 0; c < GRID_SIZE; c++) if (!marked(r, c)) { all = false; break; }
    if (all) lines++;
  }

  // Columns
  for (let c = 0; c < GRID_SIZE; c++) {
    let all = true;
    for (let r = 0; r < GRID_SIZE; r++) if (!marked(r, c)) { all = false; break; }
    if (all) lines++;
  }

  // Main diagonal (top-left -> bottom-right)
  let diag1 = true;
  for (let i = 0; i < GRID_SIZE; i++) if (!marked(i, i)) { diag1 = false; break; }
  if (diag1) lines++;

  // Anti diagonal (top-right -> bottom-left)
  let diag2 = true;
  for (let i = 0; i < GRID_SIZE; i++) if (!marked(i, GRID_SIZE - 1 - i)) { diag2 = false; break; }
  if (diag2) lines++;

  return lines;
}

/**
 * How many BINGO letters a player has earned (capped at 5).
 * @param {number} lines
 * @returns {string[]} e.g. ['B','I'] for 2 lines
 */
function bingoLetters(lines) {
  return BINGO.slice(0, Math.min(lines, LINES_TO_WIN));
}

/**
 * Has a player won? (5 or more completed lines)
 * @param {number} lines
 * @returns {boolean}
 */
function hasWon(lines) {
  return lines >= LINES_TO_WIN;
}

/**
 * Validate whether a number may be called.
 * @param {number} num
 * @param {Set<number>} calledSet
 * @returns {{ok: boolean, error?: string}}
 */
function validateCall(num, calledSet) {
  if (!Number.isInteger(num) || num < 1 || num > TOTAL_CELLS) {
    return { ok: false, error: 'Number must be an integer 1..25' };
  }
  if (calledSet.has(num)) {
    return { ok: false, error: 'Number already called' };
  }
  return { ok: true };
}

module.exports = {
  GRID_SIZE,
  TOTAL_CELLS,
  LINES_TO_WIN,
  BINGO,
  generateGrid,
  countLines,
  bingoLetters,
  hasWon,
  validateCall,
};
