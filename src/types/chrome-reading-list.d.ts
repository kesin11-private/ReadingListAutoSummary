export {};

declare global {
  namespace chrome {
    namespace readingList {
      interface ReadingListEntry {
        url: string;
        title: string;
        hasBeenRead: boolean;
        creationTime: number;
        lastUpdateTime: number;
      }

      interface QueryInfo {}

      interface UpdateEntryInfo {
        url: string;
        title?: string;
        hasBeenRead?: boolean;
      }

      interface RemoveEntryInfo {
        url: string;
      }

      function query(queryInfo?: QueryInfo): Promise<ReadingListEntry[]>;
      function updateEntry(entry: UpdateEntryInfo): Promise<void>;
      function removeEntry(entry: RemoveEntryInfo): Promise<void>;
    }
  }
}
