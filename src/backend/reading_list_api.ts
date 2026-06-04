export interface ReadingListEntry {
  url: string;
  title: string;
  hasBeenRead: boolean;
  creationTime: number;
  lastUpdateTime: number;
}

export interface UpdateReadingListEntryInfo {
  url: string;
  title?: string;
  hasBeenRead?: boolean;
}

export interface RemoveReadingListEntryInfo {
  url: string;
}

interface ReadingListApi {
  query(queryInfo?: Record<string, never>): Promise<ReadingListEntry[]>;
  updateEntry(entry: UpdateReadingListEntryInfo): Promise<void>;
  removeEntry(entry: RemoveReadingListEntryInfo): Promise<void>;
}

function getReadingListApi(): ReadingListApi {
  return (chrome as typeof chrome & { readingList: ReadingListApi })
    .readingList;
}

export async function queryReadingListEntries(): Promise<ReadingListEntry[]> {
  return getReadingListApi().query({});
}

export async function updateReadingListEntry(
  entry: UpdateReadingListEntryInfo,
): Promise<void> {
  await getReadingListApi().updateEntry(entry);
}

export async function removeReadingListEntry(
  entry: RemoveReadingListEntryInfo,
): Promise<void> {
  await getReadingListApi().removeEntry(entry);
}
