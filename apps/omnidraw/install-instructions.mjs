function normalizeShell(shellPath, platform) {
  if (platform === "win32") {
    if (!shellPath) return "powershell"
    const lower = shellPath.toLowerCase()
    if (lower.includes("cmd")) return "cmd"
    return "powershell"
  }

  if (!shellPath) return "bash"
  const shell = shellPath.split("/").pop()?.toLowerCase() ?? "bash"
  if (shell.includes("zsh")) return "zsh"
  if (shell.includes("fish")) return "fish"
  if (shell.includes("bash")) return "bash"
  return "bash"
}

function getPathExportCommand(binPath, shell, platform) {
  if (platform === "win32") {
    if (shell === "cmd") {
      return `setx PATH "%PATH%;${binPath}"`
    }
    return `$env:Path += ";${binPath}"`
  }

  if (shell === "fish") {
    return `set -Ux fish_user_paths ${binPath} $fish_user_paths`
  }

  return `export PATH="${binPath}:$PATH"`
}

function getProfileHint(shell, platform) {
  if (platform === "win32") {
    if (shell === "cmd") return "Run in Command Prompt, then restart terminal."
    return "Run in PowerShell, then restart terminal."
  }

  if (shell === "zsh") return "Add it to ~/.zshrc, then run: source ~/.zshrc"
  if (shell === "fish") return "Run the command once; fish will persist it automatically."
  return "Add it to ~/.bashrc, then run: source ~/.bashrc"
}

function getPathInstallInstruction(args) {
  const shell = normalizeShell(args.shellPath, args.platform)
  const command = getPathExportCommand(args.binPath, shell, args.platform)
  const hint = getProfileHint(shell, args.platform)

  if (args.pathConfigured) {
    return {
      shell,
      command,
      hint,
      message: `omnidraw: PATH already contains ${args.binPath}`,
    }
  }

  return {
    shell,
    command,
    hint,
    message: `omnidraw: command not found? Add ${args.binPath} to PATH.`,
  }
}

export { getPathInstallInstruction }
