import type { SocialValidationSignals, ValidationRunRequest } from '../types.js';

export function getSocialValidationSignals(
  _request: ValidationRunRequest
): SocialValidationSignals {
  return {
    twitterTrending: false,
    youtubeViews24hMillions: null,
    redditPostsCount7d: null,
  };
}
