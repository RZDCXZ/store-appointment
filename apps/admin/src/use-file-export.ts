import { useState } from "react";

import { ApiError, downloadApiFile } from "./api";
import { useAuth } from "./auth-context";

interface FileExportState {
  loading: boolean;
  message: string | null;
  error: string | null;
}

export function useFileExport(): {
  state: FileExportState;
  start: (
    path: string,
    payload: Record<string, string>,
    fallbackFilename: string,
    fallbackError: string,
  ) => Promise<void>;
} {
  const { markExpired } = useAuth();
  const [state, setState] = useState<FileExportState>({
    loading: false,
    message: null,
    error: null,
  });

  async function start(
    path: string,
    payload: Record<string, string>,
    fallbackFilename: string,
    fallbackError: string,
  ): Promise<void> {
    setState({ loading: true, message: null, error: null });
    try {
      const filename = await downloadApiFile(path, payload, fallbackFilename);
      setState({ loading: false, message: `已下载 ${filename}`, error: null });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        markExpired();
        return;
      }
      setState({
        loading: false,
        message: null,
        error: error instanceof Error ? error.message : fallbackError,
      });
    }
  }

  return { state, start };
}
