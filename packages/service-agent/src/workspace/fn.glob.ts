export function fnMatchesGlob(pattern: string, candidate: string): boolean {
  const tokens: string[] = [];
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] === '*' && pattern[index + 1] === '*') {
      tokens.push('**');
      index += 1;
    } else {
      tokens.push(pattern[index]!);
    }
  }

  let current = Array<boolean>(candidate.length + 1).fill(false);
  current[0] = true;
  for (const token of tokens) {
    const next = Array<boolean>(candidate.length + 1).fill(false);
    const isStar = token === '*' || token === '**';
    if (isStar) next[0] = current[0]!;

    for (let candidateIndex = 1; candidateIndex <= candidate.length; candidateIndex += 1) {
      const character = candidate[candidateIndex - 1]!;
      if (isStar) {
        const canConsume = token === '**' || character !== '/';
        next[candidateIndex] = current[candidateIndex]! || (canConsume && next[candidateIndex - 1]!);
      } else {
        next[candidateIndex] = current[candidateIndex - 1]! && (token === '?' || token === character);
      }
    }
    current = next;
  }

  return current[candidate.length] === true;
}
