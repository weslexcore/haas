// File System Access API members not yet in TypeScript's DOM lib.

interface FileSystemPermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FileSystemHandle {
  /** Chromium: rename/move within the same file system. */
  move?(destination: FileSystemDirectoryHandle, newName?: string): Promise<void>;
  queryPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker?(options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: FileSystemHandle | "pictures" | "desktop" | "documents" | "downloads";
  }): Promise<FileSystemDirectoryHandle>;
}

interface HTMLInputElement {
  webkitdirectory: boolean;
}
