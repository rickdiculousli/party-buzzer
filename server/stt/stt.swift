// One audio file in (argv 1), one transcript out (stdout). On-device, so party
// WiFi — which has no route to the internet — is enough. Built by swiftc at
// server boot; see server/stt.ts.
//
// `stt --probe <file>` instead opens the file once and serves ranges: a line
// "<fromMs> <toMs>" on stdin yields one transcript line on stdout. The reader's
// alignment asks the same clip hundreds of questions to find where its words
// end, and roughly nine tenths of a one-shot run is process startup — so the
// difference between a loop and a spawn per probe is minutes per pack.
import Speech
import AVFoundation
import Foundation

let args = CommandLine.arguments
let probeMode = args.count > 2 && args[1] == "--probe"
guard args.count > 1 else {
    FileHandle.standardError.write("usage: stt [--probe] <audio-file>\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: probeMode ? args[2] : args[1])
let fail = { (msg: String, _ code: Int32) -> Never in
    FileHandle.standardError.write("\(msg)\n".data(using: .utf8)!)
    exit(code)
}

/// Turns the main runloop until `ready()` or the deadline. Never a semaphore:
/// XPC to speechd is set up on the main runloop, and parking that thread
/// starves it — the task then never calls back, which is the one failure mode
/// the original spike actually hit.
func pump(until ready: () -> Bool, seconds: Double) {
    let deadline = Date().addingTimeInterval(seconds)
    while !ready() && Date() < deadline {
        RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.01))
    }
}

var recognizer: SFSpeechRecognizer?
var authorized = false
var authDone = false
SFSpeechRecognizer.requestAuthorization { status in
    if status == .authorized,
       let r = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), r.isAvailable {
        recognizer = r
        authorized = true
    }
    authDone = true
}
pump(until: { authDone }, seconds: 30)
guard authorized, let recognizer else { fail("speech recognition unavailable or not authorized", 1) }

let file: AVAudioFile
do { file = try AVAudioFile(forReading: url) } catch {
    fail("read: \(error.localizedDescription)", 1)
}
let rate = file.processingFormat.sampleRate

/// Transcribe a frame range of the open file. An empty string means the
/// recogniser heard nothing it would commit to, which for a probe is a real
/// answer — the audio up to here contains no complete word.
func transcribe(fromMs: Int, toMs: Int) -> String? {
    let first = max(0, AVAudioFramePosition(Double(fromMs) / 1000.0 * rate))
    let last = min(file.length, AVAudioFramePosition(Double(toMs) / 1000.0 * rate))
    guard last > first else { return "" }
    guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat,
                                        frameCapacity: AVAudioFrameCount(last - first)) else {
        return nil
    }
    do {
        file.framePosition = first
        try file.read(into: buffer, frameCount: AVAudioFrameCount(last - first))
    } catch {
        return nil
    }

    let request = SFSpeechAudioBufferRecognitionRequest()
    if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
    var out: String?
    var failed = false
    let task = recognizer.recognitionTask(with: request) { result, error in
        if error != nil {
            // No speech in the slice is reported as an error, and for a probe
            // that is the informative case, not a broken run.
            out = ""
            failed = true
            return
        }
        guard let result, result.isFinal else { return }
        out = result.bestTranscription.formattedString
    }
    request.append(buffer)
    request.endAudio()
    pump(until: { out != nil }, seconds: 30)
    task.cancel()
    _ = failed
    return out
}

/// Line out, right now. `print` is line-buffered on a terminal and block-
/// buffered on a pipe, which is the only way this is ever run for real — the
/// answer would sit in a 4KB buffer while the caller waited for it and we
/// waited for the caller's next question. Both processes then idle forever at
/// zero CPU, which is what a deadlock looks like from the outside.
func emit(_ s: String) {
    FileHandle.standardOutput.write("\(s)\n".data(using: .utf8)!)
}

if probeMode {
    while let line = readLine(strippingNewline: true) {
        let parts = line.split(separator: " ")
        guard parts.count == 2, let from = Int(parts[0]), let to = Int(parts[1]) else {
            FileHandle.standardError.write("bad probe: \(line)\n".data(using: .utf8)!)
            emit("")
            continue
        }
        emit(transcribe(fromMs: from, toMs: to) ?? "")
    }
    exit(0)
}

guard let text = transcribe(fromMs: 0, toMs: Int(Double(file.length) / rate * 1000) + 1) else {
    fail("recognition failed", 1)
}
print(text)
exit(0)
