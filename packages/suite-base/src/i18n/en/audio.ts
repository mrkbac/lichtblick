// SPDX-License-Identifier: MPL-2.0

export const audio = {
  autoFormat: "From message",
  channels: "Channels",
  channelsHelp: "Used when the message has no number_of_channels field.",
  enableAudio: "Click to enable audio",
  enableAudioHint: "The browser blocks sound until you interact with the page.",
  format: "Format",
  formatHelp:
    'Overrides the message\'s format field; keep "From message" unless it is missing or wrong.',
  general: "General",
  noTopic:
    "No audio topic. Pick a topic in the panel settings: foxglove.RawAudio, foxglove.CompressedAudio and audio_common_msgs/AudioData are detected automatically, and any message with a data and format field works.",
  noWebAudio: "This browser doesn't support Web Audio.",
  sampleRate: "Sample rate (Hz)",
  sampleRateHelp: "Used when the message has no sample_rate field.",
  topic: "Topic",
  topicHelp: "Audio topic to play. Defaults to the first topic with an audio schema.",
  volume: "Volume",
  volumeHelp: "Playback volume, also set by the slider next to the mute button.",
  waiting: "Waiting for audio on {{topic}}…",
};
