export type SegmentName =
  | 'hook'
  | 'context'
  | 'text'
  | 'tension'
  | 'interpretation'
  | 'application';

export interface ScriptBeat {
  narration: string;
  imagePrompt: string;
}

export interface ExplainerSegment {
  name: SegmentName;
  beats: ScriptBeat[];  // 3 beats per segment → 18 images total
}

export interface TheologyScript {
  passage: string;
  hookQuestion: string;
  segments: ExplainerSegment[];
}

export interface AudioSegment {
  audioPath: string;
  beatStartTimes: number[];       // seconds; length === beats.length; first is always 0.0
  totalDurationSeconds: number;
}

export interface SeedTopic {
  passage: string;
  question: string;
}

export interface AssembledVideo {
  landscapeVideo: string;
  shortsVideo: string;
}

export interface UploadResult {
  longformId: string;
  longformUrl: string;
  shortsId: string;
  shortsUrl: string;
}
