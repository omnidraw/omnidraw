export async function getLanguageExtension(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";

  switch (extension) {
    case "js":
    case "jsx":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true });
    case "ts":
    case "tsx":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true, typescript: true });
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "css":
    case "scss":
    case "less":
      return (await import("@codemirror/lang-css")).css();
    case "html":
      return (await import("@codemirror/lang-html")).html();
    case "py":
      return (await import("@codemirror/lang-python")).python();
    case "sql":
      return (await import("@codemirror/lang-sql")).sql();
    case "rs":
      return (await import("@codemirror/lang-rust")).rust();
    case "md":
    case "mdx":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "yaml":
    case "yml":
      return (await import("@codemirror/lang-yaml")).yaml();
    case "xml":
    case "svg":
      return (await import("@codemirror/lang-xml")).xml();
    default:
      return null;
  }
}
