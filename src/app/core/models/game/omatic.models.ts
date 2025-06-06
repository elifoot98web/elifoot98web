export interface SavedCheat {
    name: string;
    hexAddress: string;
    dataType: DataType;
}

export enum SearchType {
  STRING,
  INTEGER
}

export enum SearchState {
  NEW,
  ONGOING_SEARCH,
  MATCHES_FOUND,
  NO_MATCHES,
  ERROR
}

export enum DataType {
  BYTE = 1,
  WORD = 2,
  DWORD = 4,
  STRING = 5 // from 5 bytes and up
}