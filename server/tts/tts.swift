// Text in, audio file out — plus a mark per word saying where in the audio that
// word starts. `say` gives you the first half only, which is why the reader
// today can reveal no finer than a whole fragment.
//
// Written for `write(_:toBufferCallback:)`: the synthesiser hands us PCM in
// chunks and calls willSpeakRange in between, so the frame count at the moment
// of a range callback IS that word's offset. No search, no second pass.
//
// argv: <text-file> <out.caf> [voice] [rate]
// stdout: one JSON object — { durationMs, marks: [{ loc, len, ms }] }
import AVFoundation
import Foundation

let args = CommandLine.arguments
let trace = ProcessInfo.processInfo.environment["TTS_TRACE"] != nil

// `tts --voices` — name, quality and identifier, one per line, to compare
// against what `say -v '?'` offers.
if args.count > 1 && args[1] == "--voices" {
    for v in AVSpeechSynthesisVoice.speechVoices() where v.language.hasPrefix("en") {
        let q = [AVSpeechSynthesisVoiceQuality.default: "default",
                 .enhanced: "enhanced", .premium: "premium"][v.quality] ?? "?"
        print("\(v.name)\t\(q)\t\(v.language)\t\(v.identifier)")
    }
    exit(0)
}

guard args.count > 2 else {
    FileHandle.standardError.write("usage: tts <text-file> <out.caf> [voice] [rate]\n".data(using: .utf8)!)
    exit(2)
}
guard let text = try? String(contentsOfFile: args[1], encoding: .utf8) else {
    FileHandle.standardError.write("cannot read \(args[1])\n".data(using: .utf8)!)
    exit(1)
}
let outURL = URL(fileURLWithPath: args[2])
let voiceArg = args.count > 3 && !args[3].isEmpty ? args[3] : nil
let rateArg = args.count > 4 ? Float(args[4]) : nil

// UTF-16 offsets, because that is what NSRange counts and what JS string
// indices count. A pack with an em-dash or a curly quote stays aligned; one
// with an emoji would not survive a conversion to Unicode scalars here.
let utterance = AVSpeechUtterance(string: text)
if let voiceArg {
    let voices = AVSpeechSynthesisVoice.speechVoices()
    utterance.voice = voices.first { $0.identifier == voiceArg }
        ?? voices.first { $0.name.caseInsensitiveCompare(voiceArg) == .orderedSame }
    if utterance.voice == nil {
        FileHandle.standardError.write("no voice named \(voiceArg)\n".data(using: .utf8)!)
        exit(1)
    }
}
// The calibration knob. AVSpeech's default is not `say`'s default — it reads
// slower — so the rate that matches the room is a number you dial, not one you
// derive.
if let rateArg { utterance.rate = rateArg }

final class Writer: NSObject, AVSpeechSynthesizerDelegate {
    var file: AVAudioFile?
    var frames: Int64 = 0
    var rate: Double = 22050
    var bytesPerFrame = 4
    var markers: [(loc: Int, len: Int, offset: Int)] = []
    var failure: String?
    var finished = false

    // The offset comes from the synthesiser, not from counting what we have
    // written. Counting looked fine and was a data race: willSpeakRange arrives
    // on a different thread than the buffer callback, so sampling a running
    // frame counter gave four words the same timestamp on one run and four
    // different ones on the next, depending on what else the process was doing.
    // A marker carries its own sample offset and cannot drift.
    func speechSynthesizer(_ s: AVSpeechSynthesizer,
                           willSpeak marker: AVSpeechSynthesisMarker,
                           utterance: AVSpeechUtterance) {
        guard marker.mark == .word else { return }
        let r = marker.textRange
        markers.append((r.location, r.length, marker.byteSampleOffset))
        if trace {
            FileHandle.standardError.write(
                "mark loc=\(r.location) off=\(marker.byteSampleOffset) frames=\(frames)\n".data(using: .utf8)!)
        }
    }

    func accept(_ buffer: AVAudioBuffer) {
        guard let pcm = buffer as? AVAudioPCMBuffer else { return }
        // A zero-length buffer is how write() says it is done. It also arrives
        // first on some voices, and AVAudioFile throws on writing one, so this
        // guard is load-bearing twice.
        guard pcm.frameLength > 0 else { finished = true; return }
        do {
            if file == nil {
                rate = pcm.format.sampleRate
                // A marker's offset is named byteSampleOffset and means bytes.
                // Float32 mono is four per frame, but read it off the format
                // rather than assume: a voice that hands back int16 would put
                // every mark at twice its real time, which is a bug that reads
                // as "the reveal drifts late" rather than as a unit error.
                bytesPerFrame = Int(pcm.format.streamDescription.pointee.mBytesPerFrame)
                // The synthesiser hands back Float32; store int16 and let
                // AVAudioFile convert on write. Same bytes `say -o` produced,
                // and the clip cache does not double in size for nothing.
                var settings = pcm.format.settings
                settings[AVLinearPCMBitDepthKey] = 16
                settings[AVLinearPCMIsFloatKey] = false
                file = try AVAudioFile(forWriting: outURL, settings: settings)
            }
            try file?.write(from: pcm)
            frames += Int64(pcm.frameLength)
            if trace { FileHandle.standardError.write("buf \(pcm.frameLength) -> \(frames)\n".data(using: .utf8)!) }
        } catch {
            failure = "write: \(error.localizedDescription)"
            finished = true
        }
    }
}

let writer = Writer()
let synth = AVSpeechSynthesizer()
synth.delegate = writer
synth.write(utterance) { writer.accept($0) }

// write() is async on an internal queue; park the main runloop until the
// zero-length buffer lands. Same lesson as stt.swift — the main thread has to
// keep turning or the callbacks never come.
let deadline = Date().addingTimeInterval(60)
while !writer.finished && Date() < deadline {
    RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05))
}
if let failure = writer.failure {
    FileHandle.standardError.write("\(failure)\n".data(using: .utf8)!)
    exit(1)
}
guard writer.file != nil else {
    FileHandle.standardError.write("no audio produced\n".data(using: .utf8)!)
    exit(1)
}

let out: [String: Any] = [
    "durationMs": Int((Double(writer.frames) / writer.rate) * 1000.0),
    "marks": writer.markers.map {
        ["loc": $0.loc, "len": $0.len,
         "ms": Int((Double($0.offset / writer.bytesPerFrame) / writer.rate) * 1000.0)]
    },
]
let json = try JSONSerialization.data(withJSONObject: out)
FileHandle.standardOutput.write(json)
exit(0)
