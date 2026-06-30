import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

function basename(path: string) {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

export async function getLanguageExtension(path: string) {
  const filename = basename(path);
  const language = LanguageDescription.matchFilename(languages, filename)
    ?? LanguageDescription.matchFilename(languages, path);

  return language ? language.load() : null;
}
