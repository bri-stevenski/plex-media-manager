export interface MediaInfo {
  content_type: string;
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  episode_title: string | null;
  date_str: string | null;
  tmdb_id: number | null;
}

export type FileResult = 'organized' | 'skipped' | 'failed';
