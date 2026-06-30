export type TDeclKind = "function" | "type" | "class" | "value";

export function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

export function maskComments(content: string): string {
  let result = "";
  let index = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;

  while (index < content.length) {
    const char = content[index]!;
    const next = content[index + 1] ?? "";

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        result += "\n";
      } else {
        result += " ";
      }
      index += 1;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        result += "  ";
        inBlockComment = false;
        index += 2;
      } else {
        result += char === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }

    if (!inSingle && !inDouble && !inTemplate && char === "/" && next === "/") {
      result += "  ";
      inLineComment = true;
      index += 2;
      continue;
    }

    if (!inSingle && !inDouble && !inTemplate && char === "/" && next === "*") {
      result += "  ";
      inBlockComment = true;
      index += 2;
      continue;
    }

    result += char;

    if (escape) {
      escape = false;
      index += 1;
      continue;
    }

    if ((inSingle || inDouble || inTemplate) && char === "\\") {
      escape = true;
      index += 1;
      continue;
    }

    if (!inDouble && !inTemplate && char === "'") {
      inSingle = !inSingle;
      index += 1;
      continue;
    }

    if (!inSingle && !inTemplate && char === '"') {
      inDouble = !inDouble;
      index += 1;
      continue;
    }

    if (!inSingle && !inDouble && char === "`") {
      inTemplate = !inTemplate;
      index += 1;
      continue;
    }

    index += 1;
  }

  return result;
}

export function maskCommentsAndStrings(content: string): string {
  const noComments = maskComments(content);
  let result = "";
  let index = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escape = false;

  while (index < noComments.length) {
    const char = noComments[index]!;

    if (!inSingle && !inDouble && !inTemplate) {
      if (char === "'") {
        inSingle = true;
        result += " ";
        index += 1;
        continue;
      }
      if (char === '"') {
        inDouble = true;
        result += " ";
        index += 1;
        continue;
      }
      if (char === "`") {
        inTemplate = true;
        result += " ";
        index += 1;
        continue;
      }

      result += char;
      index += 1;
      continue;
    }

    if (escape) {
      result += char === "\n" ? "\n" : " ";
      escape = false;
      index += 1;
      continue;
    }

    if (char === "\\") {
      result += " ";
      escape = true;
      index += 1;
      continue;
    }

    if (inSingle && char === "'") {
      inSingle = false;
      result += " ";
      index += 1;
      continue;
    }

    if (inDouble && char === '"') {
      inDouble = false;
      result += " ";
      index += 1;
      continue;
    }

    if (inTemplate && char === "`") {
      inTemplate = false;
      result += " ";
      index += 1;
      continue;
    }

    result += char === "\n" ? "\n" : " ";
    index += 1;
  }

  return result;
}

export function splitNamedSpecifiers(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function splitTopLevelParams(paramText: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let depthAngle = 0;

  for (let index = 0; index < paramText.length; index += 1) {
    const char = paramText[index]!;

    if (char === "," && depthParen === 0 && depthBrace === 0 && depthBracket === 0 && depthAngle === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;

    if (char === "(") depthParen += 1;
    if (char === ")") depthParen -= 1;
    if (char === "{") depthBrace += 1;
    if (char === "}") depthBrace -= 1;
    if (char === "[") depthBracket += 1;
    if (char === "]") depthBracket -= 1;
    if (char === "<") depthAngle += 1;
    if (char === ">") depthAngle -= 1;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.filter(Boolean);
}
