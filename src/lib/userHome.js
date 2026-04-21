export function getUserHomeDir() {
  return process.env.USERPROFILE || process.env.HOME || "";
}
