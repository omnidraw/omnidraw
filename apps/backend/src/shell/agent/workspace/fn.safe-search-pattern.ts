export function fnAssertSafeSearchPattern(pattern: string): void {
  if (pattern.length > 1_000) throw new Error('Regex search patterns cannot exceed 1,000 characters.');

  let inClass = false;
  let escaped = false;
  let hasQuantifier = false;
  let hasUnboundedQuantifier = false;
  let canQuantify = false;

  for (const character of pattern) {
    if (escaped) {
      if (!inClass && /[1-9k]/.test(character)) {
        throw new Error('Regex backreferences are not supported by bounded search.');
      }
      escaped = false;
      canQuantify = true;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (inClass) {
      if (character === ']') {
        inClass = false;
        canQuantify = true;
      }
      continue;
    }
    if (character === '[') {
      inClass = true;
      canQuantify = false;
      continue;
    }
    if ('()|{}'.includes(character)) {
      throw new Error('Regex groups, alternation, and counted quantifiers are not supported by bounded search.');
    }
    if (character === '*' || character === '+') {
      if (!canQuantify) throw new Error('Regex quantifier does not follow a searchable atom.');
      if (hasQuantifier) throw new Error('Regex search supports at most one quantifier.');
      hasQuantifier = true;
      hasUnboundedQuantifier = true;
      canQuantify = false;
      continue;
    }
    if (character === '?') {
      if (!canQuantify) throw new Error('Regex quantifier does not follow a searchable atom.');
      if (hasQuantifier) throw new Error('Regex search supports at most one quantifier.');
      hasQuantifier = true;
      canQuantify = false;
      continue;
    }
    canQuantify = character !== '^' && character !== '$';
  }

  if (escaped) throw new Error('Regex search pattern ends with an incomplete escape.');
  if (inClass) throw new Error('Regex search pattern contains an unterminated character class.');
  if (hasUnboundedQuantifier && !pattern.startsWith('^')) {
    throw new Error("Regex searches with '*' or '+' must be anchored at the start with '^'.");
  }
}
