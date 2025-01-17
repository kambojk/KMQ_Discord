import type AnswerType from "../enums/option_types/answer_type";
import type ArtistType from "../enums/option_types/artist_type";
import type Gender from "../enums/option_types/gender";
import type GuessModeType from "../enums/option_types/guess_mode_type";
import type LanguageType from "../enums/option_types/language_type";
import type MatchedArtist from "./matched_artist";
import type MultiGuessType from "../enums/option_types/multiguess_type";
import type OstPreference from "../enums/option_types/ost_preference";
import type ReleaseType from "../enums/option_types/release_type";
import type SeekType from "../enums/option_types/seek_type";
import type ShuffleType from "../enums/option_types/shuffle_type";
import type SpecialType from "../enums/option_types/special_type";
import type SubunitsPreference from "../enums/option_types/subunit_preference";

export default interface GameOptions {
    beginningYear: number;
    endYear: number;
    gender: Array<Gender>;
    limitStart: number;
    limitEnd: number;
    seekType: SeekType;
    specialType: SpecialType;
    guessModeType: GuessModeType;
    releaseType: ReleaseType;
    artistType: ArtistType;
    answerType: AnswerType;
    shuffleType: ShuffleType;
    groups: MatchedArtist[];
    excludes: MatchedArtist[];
    includes: MatchedArtist[];
    goal: number;
    guessTimeout: number;
    duration: number;
    languageType: LanguageType;
    multiGuessType: MultiGuessType;
    subunitPreference: SubunitsPreference;
    ostPreference: OstPreference;
    forcePlaySongID: string;
}
