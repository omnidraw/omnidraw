import { apiFilesFilesystem } from './api.files-filesystem';
import { apiHomeFilesystem } from './api.home-filesystem';
import { apiInspectFilesystem } from './api.inspect-filesystem';
import { apiKeepaliveWatchFilesystem } from './api.keepalive-watch-filesystem';
import { apiListFilesystem } from './api.list-filesystem';
import { apiListRegisteredFilesystems } from './api.list-registered-filesystems';
import { apiMoveFilesystem } from './api.move-filesystem';
import { apiReadFilesystem } from './api.read-filesystem';
import { apiUnwatchFilesystem } from './api.unwatch-filesystem';
import { apiWatchFilesystem } from './api.watch-filesystem';
import { apiWriteFilesystem } from './api.write-filesystem';
import { baseFilesystemOs } from './orpc';

const filesystemHandlers = {
  listRegisteredFilesystems: apiListRegisteredFilesystems,
  home: apiHomeFilesystem,
  list: apiListFilesystem,
  files: apiFilesFilesystem,
  move: apiMoveFilesystem,
  inspect: apiInspectFilesystem,
  read: apiReadFilesystem,
  write: apiWriteFilesystem,
  watch: apiWatchFilesystem,
  keepaliveWatch: apiKeepaliveWatchFilesystem,
  unwatch: apiUnwatchFilesystem,
};

export { baseFilesystemOs, filesystemHandlers };
