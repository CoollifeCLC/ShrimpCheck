import { Challenge } from './types';

// Seed challenge library for Challenge Mode v1.
//
// Content only — no UI or scoring logic lives here. Problem statements are
// original wording written for Shrimp Check, inspired by common interview
// patterns. To add a challenge, append an object that satisfies `Challenge`;
// `test/challenges.test.js` checks that every seeded challenge has a working
// reference solution.

const tree = (val: number, left: unknown = null, right: unknown = null) => ({ val, left, right });

export const CHALLENGES: Challenge[] = [
  // ── Strings ──────────────────────────────────────────────────────────────
  {
    id: 'reverse-in-place',
    title: 'Reverse in Place',
    difficulty: 'easy',
    category: 'strings',
    description:
      'A word arrives as an array of single characters. Reverse the order of the characters **in the same array** — do not build a new one. The function does not need to return anything.',
    examples: [
      { input: "chars = ['s','h','r','i','m','p']", output: "['p','m','i','r','h','s']" },
      { input: "chars = ['o','k']", output: "['k','o']" }
    ],
    constraints: ['0 ≤ chars.length ≤ 10⁵', 'Use O(1) extra memory'],
    functionName: 'reverseInPlace',
    starterCode: `/**
 * @param {string[]} chars
 * @returns {void} Modify chars in place.
 */
function reverseInPlace(chars) {
  // your code here
}
`,
    tests: [
      { args: [['s', 'h', 'r', 'i', 'm', 'p']], expected: ['p', 'm', 'i', 'r', 'h', 's'], inPlaceArg: 0 },
      { args: [['o', 'k']], expected: ['k', 'o'], inPlaceArg: 0 },
      { args: [[]], expected: [], inPlaceArg: 0 },
      { args: [['a']], expected: ['a'], inPlaceArg: 0, hidden: true },
      { args: [['a', 'b', 'c', 'd', 'e']], expected: ['e', 'd', 'c', 'b', 'a'], inPlaceArg: 0, hidden: true }
    ],
    pattern: 'Two Pointers (swap from both ends)',
    hint: 'Keep one index at the start and one at the end. What should happen to the two characters they point at?',
    approach:
      'Set left = 0 and right = length - 1. While left < right, swap chars[left] and chars[right], then move left forward and right backward.',
    expectedTimeComplexity: 'O(n)',
    expectedSpaceComplexity: 'O(1)',
    tags: ['in-place', 'swap'],
    enabled: true
  },
  {
    id: 'run-length-squeeze',
    title: 'Run-Length Squeeze',
    difficulty: 'easy',
    category: 'strings',
    description:
      'Compress a string by replacing each run of the same character with the character followed by the run length. Runs of length 1 keep just the character (no "1").',
    examples: [
      { input: 's = "aaabcc"', output: '"a3bc2"' },
      { input: 's = "abc"', output: '"abc"', explanation: 'No run is longer than 1.' }
    ],
    constraints: ['0 ≤ s.length ≤ 10⁴', 's contains printable ASCII characters'],
    functionName: 'squeeze',
    starterCode: `/**
 * @param {string} s
 * @returns {string}
 */
function squeeze(s) {
  // your code here
}
`,
    tests: [
      { args: ['aaabcc'], expected: 'a3bc2' },
      { args: ['abc'], expected: 'abc' },
      { args: [''], expected: '' },
      { args: ['zzzzzzzzzzzz'], expected: 'z12', hidden: true },
      { args: ['aabbaa'], expected: 'a2b2a2', hidden: true }
    ],
    pattern: 'Linear scan with a run counter',
    hint: 'Walk the string once, counting how long the current run is. When does a run end?',
    approach:
      'Track the current character and its count. When the next character differs (or the string ends), append the character plus the count if count > 1, then reset. Build pieces in an array and join once.',
    expectedTimeComplexity: 'O(n)',
    expectedSpaceComplexity: 'O(n)',
    tags: ['scan', 'string-building'],
    enabled: true
  },

  // ── Arrays ───────────────────────────────────────────────────────────────
  {
    id: 'best-shrimp-trade',
    title: 'Best Shrimp Trade',
    difficulty: 'easy',
    category: 'arrays',
    description:
      'You get the price of shrimp for each day, in order. You may buy once and sell once on a **later** day. Return the largest profit you can make, or 0 if no trade makes money.',
    examples: [
      { input: 'prices = [7,1,5,3,6,4]', output: '5', explanation: 'Buy at 1, sell at 6.' },
      { input: 'prices = [7,6,4,3,1]', output: '0', explanation: 'Prices only fall.' }
    ],
    constraints: ['1 ≤ prices.length ≤ 10⁵', '0 ≤ prices[i] ≤ 10⁴'],
    functionName: 'maxProfit',
    starterCode: `/**
 * @param {number[]} prices
 * @returns {number}
 */
function maxProfit(prices) {
  // your code here
}
`,
    tests: [
      { args: [[7, 1, 5, 3, 6, 4]], expected: 5 },
      { args: [[7, 6, 4, 3, 1]], expected: 0 },
      { args: [[2, 4, 1]], expected: 2 },
      { args: [[1]], expected: 0, hidden: true },
      { args: [[3, 3, 5, 0, 0, 3, 1, 4]], expected: 4, hidden: true }
    ],
    pattern: 'Single pass with a running minimum',
    hint: 'For each day, what is the best price you could have bought at before it?',
    approach:
      'Keep the lowest price seen so far. For each price, profit = price - lowest; keep the maximum profit. Update lowest after checking.',
    expectedTimeComplexity: 'O(n)',
    expectedSpaceComplexity: 'O(1)',
    tags: ['greedy', 'prefix-min'],
    enabled: true
  },

  // ── Hash Maps / Sets ─────────────────────────────────────────────────────
  {
    id: 'pair-to-target',
    title: 'Pair to Target',
    difficulty: 'easy',
    category: 'hashing',
    description:
      'Given an array of integers and a target, return the indices of the two **different** positions whose values add up to the target. Exactly one such pair exists. Return the two indices in any order.',
    examples: [
      { input: 'nums = [2,7,11,15], target = 9', output: '[0,1]' },
      { input: 'nums = [3,2,4], target = 6', output: '[1,2]' }
    ],
    constraints: ['2 ≤ nums.length ≤ 10⁴', 'Exactly one valid answer exists', 'Aim for better than O(n²)'],
    functionName: 'pairToTarget',
    starterCode: `/**
 * @param {number[]} nums
 * @param {number} target
 * @returns {number[]} The two indices.
 */
function pairToTarget(nums, target) {
  // your code here
}
`,
    tests: [
      { args: [[2, 7, 11, 15], 9], expected: [0, 1], compare: 'sorted' },
      { args: [[3, 2, 4], 6], expected: [1, 2], compare: 'sorted' },
      { args: [[3, 3], 6], expected: [0, 1], compare: 'sorted' },
      { args: [[-1, -2, -3, -4, -5], -8], expected: [2, 4], compare: 'sorted', hidden: true },
      { args: [[0, 4, 3, 0], 0], expected: [0, 3], compare: 'sorted', hidden: true }
    ],
    pattern: 'Hash Map complement lookup',
    hint: 'For each number, you already know which other number would complete the pair. Can you look it up in O(1)?',
    approach:
      'Walk the array once with a Map from value → index. For each nums[i], check whether target - nums[i] is already in the map; if so return [map.get(...), i]. Otherwise store nums[i] → i.',
    expectedTimeComplexity: 'O(n)',
    expectedSpaceComplexity: 'O(n)',
    tags: ['map', 'complement'],
    enabled: true
  },
  {
    id: 'same-letters',
    title: 'Same Letters, New Order',
    difficulty: 'easy',
    category: 'hashing',
    description:
      'Return true if the second string uses exactly the same letters as the first — same letters, same counts — just possibly rearranged.',
    examples: [
      { input: 'a = "listen", b = "silent"', output: 'true' },
      { input: 'a = "rat", b = "car"', output: 'false' }
    ],
    constraints: ['0 ≤ a.length, b.length ≤ 5 × 10⁴', 'Lowercase English letters only'],
    functionName: 'sameLetters',
    starterCode: `/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameLetters(a, b) {
  // your code here
}
`,
    tests: [
      { args: ['listen', 'silent'], expected: true },
      { args: ['rat', 'car'], expected: false },
      { args: ['', ''], expected: true },
      { args: ['aacc', 'ccac'], expected: false, hidden: true },
      { args: ['shrimp', 'primsh'], expected: true, hidden: true },
      { args: ['ab', 'abc'], expected: false, hidden: true }
    ],
    pattern: 'Frequency counting',
    hint: 'Two strings are rearrangements of each other exactly when every letter appears the same number of times in both.',
    approach:
      'If lengths differ return false. Count letters of a in a map (or 26-slot array), subtract counts for b, and return false if any count goes below zero.',
    expectedTimeComplexity: 'O(n)',
    expectedSpaceComplexity: 'O(1) — at most 26 letters',
    tags: ['counting', 'map'],
    enabled: true
  },
  {
    id: 'seen-it-before',
    title: 'Seen It Before',
    difficulty: 'easy',
    category: 'hashing',
    description: 'Return true if any value appears at least twice in the array, and false if every value is distinct.',
    examples: [
      { input: 'nums = [1,2,3,1]', output: 'true' },
      { input: 'nums = [1,2,3,4]', output: 'false' }
    ],
    constraints: ['0 ≤ nums.length ≤ 10⁵'],
    functionName: 'hasRepeat',
    starterCode: `/**
 * @param {number[]} nums
 * @returns {boolean}
 */
function hasRepeat(nums) {
  // your code here
}
`,
    tests: [
      { args: [[1, 2, 3, 1]], expected: true },
      { args: [[1, 2, 3, 4]], expected: false },
      { args: [[]], expected: false },
      { args: [[5, 5]], expected: true, hidden: true },
      { args: [[1, 1, 1, 3, 3, 4, 3, 2, 4, 2]], expected: true, hidden: true }
    ],
    pattern: 'Hash Set membership',
    hint: 'As you walk the array, remember everything you have already seen.',
    approach: 'Use a Set. For each value: if it is already in the set return true, otherwise add it. Return false at the end.',
    expectedTimeComplexity: 'O(n)',
    expectedSpaceComplexity: 'O(n)',
    tags: ['set'],
    enabled: true
  },

  // ── Two Pointers ─────────────────────────────────────────────────────────
  {
    id: 'mirror-check',
    title: 'Mirror Check',
    difficulty: 'easy',
    category: 'twoPointers',
    description:
      'Decide whether a phrase reads the same forwards and backwards. Ignore everything that is not a letter or digit, and ignore letter case.',
    examples: [
      { input: 's = "Taco cat!"', output: 'true', explanation: 'Cleaned: "tacocat".' },
      { input: 's = "race a car"', output: 'false', explanation: 'Cleaned: "raceacar".' }
    ],
    constraints: ['0 ≤ s.length ≤ 2 × 10⁵', 'Try to use O(1) extra memory'],
    functionName: 'isMirror',
    starterCode: `/**
 * @param {string} s
 * @returns {boolean}
 */
function isMirror(s) {
  // your code here
}
`,
    tests: [
      { args: ['Taco cat!'], expected: true },
      { args: ['race a car'], expected: false },
      { args: [''], expected: true },
      { args: ['.,'], expected: true, hidden: true },
      { args: ['0P'], expected: false, hidden: true },
      { args: ["No 'x' in Nixon"], expected: true, hidden: true },
      { args: ['ab_a'], expected: true, hidden: true }
    ],
    pattern: 'Two Pointers (converging)',
    hint: 'Compare from both ends at once, skipping characters that do not count.',
    approach:
      'left = 0, right = s.length - 1. Advance left past non-alphanumerics, retreat right likewise. Compare lowercased characters; on mismatch return false; otherwise move both inward. Return true when they cross.',
    expectedTimeComplexity: 'O(n)',
    expectedSpaceComplexity: 'O(1)',
    tags: ['palindrome', 'string'],
    enabled: true
  },
  {
    id: 'zeroes-to-the-back',
    title: 'Zeroes to the Back',
    difficulty: 'easy',
    category: 'twoPointers',
    description:
      'Move every 0 in the array to the end **in place**, keeping the relative order of the non-zero values. The function does not need to return anything.',
    examples: [
      { input: 'nums = [0,1,0,3,12]', output: '[1,3,12,0,0]' },
      { input: 'nums = [0]', output: '[0]' }
    ],
    constraints: ['1 ≤ nums.length ≤ 10⁴', 'Do not copy the array'],
    functionName: 'zeroesToBack',
    starterCode: `/**
 * @param {number[]} nums
 * @returns {void} Modify nums in place.
 */
function zeroesToBack(nums) {
  // your code here
}
`,
    tests: [
      { args: [[0, 1, 0, 3, 12]], expected: [1, 3, 12, 0, 0], inPlaceArg: 0 },
      { args: [[0]], expected: [0], inPlaceArg: 0 },
      { args: [[1, 2]], expected: [1, 2], inPlaceArg: 0 },
      { args: [[0, 0, 1]], expected: [1, 0, 0], inPlaceArg: 0, hidden: true },
      { args: [[4, 0, 5, 0, 0, 6]], expected: [4, 5, 6, 0, 0, 0], inPlaceArg: 0, hidden: true }
    ],
    pattern: 'Two Pointers (read / write)',
    hint: 'One index reads every element; another marks where the next non-zero value should be written.',
    approach:
      'write = 0. For each read index, if nums[read] !== 0, swap nums[read] with nums[write] and increment write. Everything after write ends up as zero.',
    expectedTimeComplexity: 'O(n)',
    expectedSpaceComplexity: 'O(1)',
    tags: ['in-place', 'partition'],
    enabled: true
  },

  // ── Sliding Window ───────────────────────────────────────────────────────
  {
    id: 'longest-fresh-stretch',
    title: 'Longest Fresh Stretch',
    difficulty: 'medium',
    category: 'slidingWindow',
    description:
      'Return the length of the longest contiguous stretch of the string in which no character repeats.',
    examples: [
      { input: 's = "abcabcbb"', output: '3', explanation: '"abc" is the longest stretch.' },
      { input: 's = "pwwkew"', output: '3', explanation: '"wke". A non-contiguous pick like "pwke" does not count.' }
    ],
    constraints: ['0 ≤ s.length ≤ 5 × 10⁴'],
    functionName: 'longestFreshStretch',
    starterCode: `/**
 * @param {string} s
 * @returns {number}
 */
function longestFreshStretch(s) {
  // your code here
}
`,
    tests: [
      { args: ['abcabcbb'], expected: 3 },
      { args: ['bbbbb'], expected: 1 },
      { args: ['pwwkew'], expected: 3 },
      { args: [''], expected: 0, hidden: true },
      { args: [' '], expected: 1, hidden: true },
      { args: ['dvdf'], expected: 3, hidden: true },
      { args: ['abba'], expected: 2, hidden: true },
      { args: ['tmmzuxt'], expected: 5, hidden: true }
    ],
    pattern: 'Sliding Window + last-seen Map',
    hint: 'Grow a window to the right. When a repeat appears inside it, where must the left edge jump to?',
    approach:
      'Keep a Map of char → last index and a left pointer. For each right index, if s[right] was last seen at or after left, move left to lastSeen + 1. Record s[right] → right and track max(right - left + 1).',
    expectedTimeComplexity: 'O(n)',
    expectedSpaceComplexity: 'O(min(n, alphabet))',
    tags: ['window', 'map'],
    enabled: true
  },

  // ── Stacks / Queues ──────────────────────────────────────────────────────
  {
    id: 'bracket-balance',
    title: 'Bracket Balance',
    difficulty: 'easy',
    category: 'stacksQueues',
    description:
      'A string contains only the characters ( ) [ ] { }. Return true if every opener is closed by the matching closer in the correct order.',
    examples: [
      { input: 's = "([{}])"', output: 'true' },
      { input: 's = "(]"', output: 'false' },
      { input: 's = "([)]"', output: 'false', explanation: 'Closers arrive in the wrong order.' }
    ],
    constraints: ['0 ≤ s.length ≤ 10⁴'],
    functionName: 'isBalanced',
    starterCode: `/**
 * @param {string} s
 * @returns {boolean}
 */
function isBalanced(s) {
  // your code here
}
`,
    tests: [
      { args: ['()[]{}'], expected: true },
      { args: ['(]'], expected: false },
      { args: ['([{}])'], expected: true },
      { args: ['(('], expected: false },
      { args: [''], expected: true, hidden: true },
      { args: [')('], expected: false, hidden: true },
      { args: ['{[]}('], expected: false, hidden: true },
      { args: ['([)]'], expected: false, hidden: true }
    ],
    pattern: 'Stack of open brackets',
    hint: 'The most recently opened bracket must be the first one closed.',
    approach:
      'Push openers onto a stack. For a closer, pop and check it matches; if the stack is empty or it mismatches, return false. At the end, the stack must be empty.',
    expectedTimeComplexity: 'O(n)',
    expectedSpaceComplexity: 'O(n)',
    tags: ['stack', 'parsing'],
    enabled: true
  },

  // ── Binary Search ────────────────────────────────────────────────────────
  {
    id: 'find-in-sorted',
    title: 'Find in Sorted',
    difficulty: 'easy',
    category: 'binarySearch',
    description:
      'Given an array of distinct integers sorted in ascending order, return the index of the target, or -1 if it is not present. Aim for O(log n).',
    examples: [
      { input: 'nums = [-1,0,3,5,9,12], target = 9', output: '4' },
      { input: 'nums = [-1,0,3,5,9,12], target = 2', output: '-1' }
    ],
    constraints: ['0 ≤ nums.length ≤ 10⁴', 'All values are distinct', 'Do not use indexOf / includes'],
    functionName: 'findInSorted',
    starterCode: `/**
 * @param {number[]} nums
 * @param {number} target
 * @returns {number}
 */
function findInSorted(nums, target) {
  // your code here
}
`,
    tests: [
      { args: [[-1, 0, 3, 5, 9, 12], 9], expected: 4 },
      { args: [[-1, 0, 3, 5, 9, 12], 2], expected: -1 },
      { args: [[5], 5], expected: 0 },
      { args: [[], 1], expected: -1, hidden: true },
      { args: [[1, 3], 3], expected: 1, hidden: true },
      { args: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1], expected: 0, hidden: true },
      { args: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 11], expected: -1, hidden: true }
    ],
    pattern: 'Binary Search (closed interval)',
    hint: 'Look at the middle element. Which half can you throw away?',
    approach:
      'lo = 0, hi = n - 1. While lo <= hi: mid = (lo + hi) >> 1; return mid on match; if nums[mid] < target set lo = mid + 1 else hi = mid - 1. Return -1.',
    expectedTimeComplexity: 'O(log n)',
    expectedSpaceComplexity: 'O(1)',
    tags: ['divide-and-conquer'],
    enabled: true
  },

  // ── Recursion ────────────────────────────────────────────────────────────
  {
    id: 'unpack-the-crates',
    title: 'Unpack the Crates',
    difficulty: 'easy',
    category: 'recursion',
    description:
      'Crates can contain numbers or more crates (nested arrays), to any depth. Return a single flat array of all the numbers in their original left-to-right order. Try it without `Array.prototype.flat`.',
    examples: [
      { input: 'crates = [1,[2,[3,[4]],5]]', output: '[1,2,3,4,5]' },
      { input: 'crates = [[[]]]', output: '[]' }
    ],
    constraints: ['Total number of values ≤ 10⁴', 'Nesting depth ≤ 100'],
    functionName: 'unpack',
    starterCode: `/**
 * @param {Array<number|Array>} crates
 * @returns {number[]}
 */
function unpack(crates) {
  // your code here
}
`,
    tests: [
      { args: [[1, [2, [3, [4]], 5]]], expected: [1, 2, 3, 4, 5] },
      { args: [[[[]]]], expected: [] },
      { args: [[1, 2]], expected: [1, 2] },
      { args: [[]], expected: [], hidden: true },
      { args: [[[1], [2, [3]], [[[4]]]]], expected: [1, 2, 3, 4], hidden: true }
    ],
    pattern: 'Recursion (depth-first)',
    hint: 'If an item is itself an array, the same problem applies to it.',
    approach:
      'Create a result array and a helper visit(items). For each item: if Array.isArray(item) call visit(item), otherwise push it. Call visit(crates) and return the result.',
    expectedTimeComplexity: 'O(n)',
    expectedSpaceComplexity: 'O(d) call stack, d = depth',
    tags: ['recursion', 'dfs'],
    enabled: true
  },

  // ── Trees ────────────────────────────────────────────────────────────────
  {
    id: 'how-deep-is-the-reef',
    title: 'How Deep Is the Reef',
    difficulty: 'easy',
    category: 'trees',
    description:
      'A binary tree node looks like `{ val, left, right }`, where left and right are nodes or null. Return the number of nodes on the longest path from the root down to a leaf. An empty tree (null) has depth 0.',
    examples: [
      { input: 'root = {val:3, left:{val:9}, right:{val:20, left:{val:15}, right:{val:7}}}', output: '3' },
      { input: 'root = null', output: '0' }
    ],
    constraints: ['0 ≤ number of nodes ≤ 10⁴'],
    functionName: 'reefDepth',
    starterCode: `/**
 * @typedef {{ val: number, left: TreeNode|null, right: TreeNode|null }} TreeNode
 * @param {TreeNode|null} root
 * @returns {number}
 */
function reefDepth(root) {
  // your code here
}
`,
    tests: [
      { args: [tree(3, tree(9), tree(20, tree(15), tree(7)))], expected: 3 },
      { args: [null], expected: 0 },
      { args: [tree(1)], expected: 1 },
      { args: [tree(1, tree(2, tree(3, tree(4))))], expected: 4, hidden: true },
      { args: [tree(1, null, tree(2))], expected: 2, hidden: true }
    ],
    pattern: 'Tree DFS (post-order)',
    hint: 'The depth of a tree is 1 + the depth of its deeper child.',
    approach: 'If root is null return 0. Otherwise return 1 + Math.max(reefDepth(root.left), reefDepth(root.right)).',
    expectedTimeComplexity: 'O(n)',
    expectedSpaceComplexity: 'O(h) call stack, h = height',
    tags: ['tree', 'dfs'],
    enabled: true
  },

  // ── Practical: API ───────────────────────────────────────────────────────
  {
    id: 'query-string-builder',
    title: 'Query String Builder',
    difficulty: 'easy',
    category: 'api',
    description:
      'Build a URL query string from a params object. Rules: keys stay in insertion order; keys and values are URI-encoded; `null` values are skipped; array values repeat the key once per item; return "" when nothing is left, otherwise start with "?".',
    examples: [
      { input: "params = { q: 'shrimp tacos', page: 2 }", output: '"?q=shrimp%20tacos&page=2"' },
      { input: "params = { tags: ['a','b'], sort: null }", output: '"?tags=a&tags=b"' }
    ],
    constraints: ['Values are strings, numbers, booleans, null, or arrays of those'],
    functionName: 'buildQuery',
    starterCode: `/**
 * @param {Record<string, string|number|boolean|null|Array<string|number|boolean>>} params
 * @returns {string}
 */
function buildQuery(params) {
  // your code here
}
`,
    tests: [
      { args: [{ q: 'shrimp tacos', page: 2 }], expected: '?q=shrimp%20tacos&page=2' },
      { args: [{ tags: ['a', 'b'], sort: null }], expected: '?tags=a&tags=b' },
      { args: [{}], expected: '' },
      { args: [{ 'a&b': 'c=d' }], expected: '?a%26b=c%3Dd', hidden: true },
      { args: [{ flag: true, empty: null }], expected: '?flag=true', hidden: true }
    ],
    pattern: 'Normalize, then encode and join',
    hint: 'Turn the object into a flat list of [key, value] pairs first; encoding and joining become one line.',
    approach:
      'For each [key, value] of Object.entries(params): skip null; if Array.isArray(value) push one pair per item; else push [key, value]. Map pairs to encodeURIComponent(k) + "=" + encodeURIComponent(String(v)), join with "&", and prefix "?" when non-empty.',
    expectedTimeComplexity: 'O(n)',
    expectedSpaceComplexity: 'O(n)',
    tags: ['url', 'encoding'],
    enabled: true
  },

  // ── Practical: Async / Promises ──────────────────────────────────────────
  {
    id: 'gather-the-profiles',
    title: 'Gather the Profiles',
    difficulty: 'medium',
    category: 'async',
    description:
      'A helper `fetchProfile(id)` is already defined for you. It returns a Promise that resolves to `{ id, name }` or rejects when the profile does not exist. Write an **async** function that fetches all ids concurrently and resolves to the names of the profiles that loaded, in the same order as the input ids. Failed lookups are skipped, not thrown.',
    examples: [
      { input: 'ids = [1,2,3]', output: '["user1","user2","user3"]' },
      { input: 'ids = [4,-1,5]', output: '["user4","user5"]', explanation: 'Profile -1 rejects and is skipped.' }
    ],
    constraints: ['0 ≤ ids.length ≤ 100', 'Fetch concurrently, not one after another'],
    functionName: 'gatherProfiles',
    setup: `function fetchProfile(id) {
  return Promise.resolve().then(function () {
    if (id < 0) throw new Error('Profile ' + id + ' not found');
    return { id: id, name: 'user' + id };
  });
}`,
    starterCode: `/**
 * fetchProfile(id) is provided: (id: number) => Promise<{ id: number, name: string }>
 *
 * @param {number[]} ids
 * @returns {Promise<string[]>}
 */
async function gatherProfiles(ids) {
  // your code here
}
`,
    tests: [
      { args: [[1, 2, 3]], expected: ['user1', 'user2', 'user3'] },
      { args: [[4, -1, 5]], expected: ['user4', 'user5'] },
      { args: [[]], expected: [], hidden: true },
      { args: [[-1, -2]], expected: [], hidden: true }
    ],
    pattern: 'Promise.allSettled fan-out',
    hint: 'Start every request first, then wait for all of them — without letting one rejection sink the rest.',
    approach:
      'const results = await Promise.allSettled(ids.map(fetchProfile)); return results.filter(r => r.status === "fulfilled").map(r => r.value.name).',
    expectedTimeComplexity: 'O(n)',
    expectedSpaceComplexity: 'O(n)',
    tags: ['promises', 'concurrency'],
    enabled: true
  },

  // ── Practical: Regex ─────────────────────────────────────────────────────
  {
    id: 'hex-color-check',
    title: 'Hex Color Check',
    difficulty: 'easy',
    category: 'regex',
    description:
      'Return true if the input is a CSS hex color: a "#" followed by exactly 3 or exactly 6 hexadecimal digits (case-insensitive), with nothing before or after.',
    examples: [
      { input: 's = "#A1b2C3"', output: 'true' },
      { input: 's = "#ffff"', output: 'false', explanation: 'Four digits is neither 3 nor 6.' }
    ],
    constraints: ['0 ≤ s.length ≤ 100'],
    functionName: 'isHexColor',
    starterCode: `/**
 * @param {string} s
 * @returns {boolean}
 */
function isHexColor(s) {
  // your code here
}
`,
    tests: [
      { args: ['#fff'], expected: true },
      { args: ['#A1b2C3'], expected: true },
      { args: ['fff'], expected: false },
      { args: ['#ffff'], expected: false },
      { args: ['#ggg'], expected: false, hidden: true },
      { args: [' #fff'], expected: false, hidden: true },
      { args: ['#abcdef0'], expected: false, hidden: true }
    ],
    pattern: 'Anchored regex with alternation',
    hint: 'Anchor both ends, and remember 3 OR 6 digits — not 3 to 6.',
    approach: 'return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);',
    expectedTimeComplexity: 'O(n)',
    expectedSpaceComplexity: 'O(1)',
    tags: ['regex', 'validation'],
    enabled: true
  }
];

export function getChallengeById(id: string): Challenge | undefined {
  return CHALLENGES.find((challenge) => challenge.id === id);
}
