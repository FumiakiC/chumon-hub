export interface LogEntry {
  timestamp: string
  message: string
  type: "info" | "success" | "error"
}
