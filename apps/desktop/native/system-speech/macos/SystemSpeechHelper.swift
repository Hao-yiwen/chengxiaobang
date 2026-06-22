import AVFoundation
import Foundation
import Speech

final class JsonEmitter {
  private let lock = NSLock()
  private let outputHandle: FileHandle?

  init(outputPath: String?) {
    if let outputPath {
      FileManager.default.createFile(atPath: outputPath, contents: nil)
      self.outputHandle = FileHandle(forWritingAtPath: outputPath)
    } else {
      self.outputHandle = nil
    }
  }

  deinit {
    try? outputHandle?.close()
  }

  func close() {
    lock.lock()
    defer { lock.unlock() }
    if let outputHandle {
      try? outputHandle.synchronize()
      try? outputHandle.close()
    }
    fflush(stdout)
  }

  func emit(_ payload: [String: Any]) {
    lock.lock()
    defer { lock.unlock() }
    do {
      let data = try JSONSerialization.data(withJSONObject: payload, options: [])
      if let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout)
        if let outputHandle, let outputData = "\(line)\n".data(using: .utf8) {
          try? outputHandle.seekToEnd()
          outputHandle.write(outputData)
        }
      }
    } catch {
      let fallback = #"{"type":"error","error":"JSON 序列化失败"}"#
      print(fallback)
      fflush(stdout)
    }
  }
}

final class RecognitionController {
  private let language: String
  private let maxSeconds: Double
  private let emitter: JsonEmitter
  private let recognizer: SFSpeechRecognizer
  private let audioEngine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var lastText = ""
  private var startedAt = Date()
  private var finishStarted = false
  private var stopRequested = false
  private var tapInstalled = false
  private var lastLevelEmitAt = Date.distantPast
  private let stateQueue = DispatchQueue(label: "chengxiaobang.system-speech.state")

  init?(language: String, maxSeconds: Double, emitter: JsonEmitter) {
    self.language = language
    self.maxSeconds = maxSeconds
    self.emitter = emitter
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language)) else {
      return nil
    }
    self.recognizer = recognizer
  }

  func start() {
    requestMicrophonePermission { [weak self] allowed in
      guard let self else { return }
      if !allowed {
        self.finish(type: "error", text: "", error: "麦克风录音权限未授权")
        return
      }
      self.requestSpeechPermission { [weak self] allowed, reason in
        guard let self else { return }
        if !allowed {
          self.finish(type: "error", text: "", error: reason ?? "语音识别权限未授权")
          return
        }
        DispatchQueue.main.async {
          self.startRecognition()
        }
      }
    }
  }

  func requestStop() {
    stateQueue.async {
      if self.finishStarted || self.stopRequested {
        return
      }
      self.stopRequested = true
      self.emitter.emit([
        "type": "stopping",
        "language": self.language,
      ])
      DispatchQueue.main.async {
        self.stopAudio()
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
        self.finish(type: "final", text: self.lastText, error: nil)
      }
    }
  }

  func cancel() {
    finish(type: "cancelled", text: lastText, error: nil)
  }

  private func startRecognition() {
    guard recognizer.isAvailable else {
      finish(type: "error", text: "", error: "当前系统语音识别服务不可用")
      return
    }

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if #available(macOS 13.0, *) {
      request.addsPunctuation = true
    }
    self.request = request

    let inputNode = audioEngine.inputNode
    let format = inputNode.outputFormat(forBus: 0)
    inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self, weak request] buffer, _ in
      request?.append(buffer)
      self?.emitLevel(from: buffer)
    }
    tapInstalled = true

    do {
      audioEngine.prepare()
      try audioEngine.start()
    } catch {
      finish(type: "error", text: "", error: "麦克风启动失败：\(error.localizedDescription)")
      return
    }

    startedAt = Date()
    emitter.emit([
      "type": "ready",
      "language": language,
    ])

    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self else { return }
      if let result {
        self.lastText = result.bestTranscription.formattedString
        self.emitter.emit([
          "type": result.isFinal ? "final" : "partial",
          "language": self.language,
          "text": self.lastText,
          "isFinal": result.isFinal,
          "elapsedMs": self.elapsedMs(),
        ])
        if result.isFinal {
          self.finish(type: "final", text: self.lastText, error: nil)
          return
        }
      }

      if let error {
        if self.stopRequested {
          self.finish(type: "final", text: self.lastText, error: nil)
          return
        }
        self.finish(type: "error", text: self.lastText, error: error.localizedDescription)
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + maxSeconds) { [weak self] in
      self?.requestStop()
    }
  }

  private func emitLevel(from buffer: AVAudioPCMBuffer) {
    let level = Self.normalizedLevel(from: buffer)
    stateQueue.async {
      let now = Date()
      if now.timeIntervalSince(self.lastLevelEmitAt) < 0.06 {
        return
      }
      self.lastLevelEmitAt = now
      self.emitter.emit([
        "type": "level",
        "language": self.language,
        "level": level,
        "elapsedMs": self.elapsedMs(),
      ])
    }
  }

  private static func normalizedLevel(from buffer: AVAudioPCMBuffer) -> Double {
    guard let channels = buffer.floatChannelData else {
      return 0
    }
    let channelCount = max(1, Int(buffer.format.channelCount))
    let frameCount = max(1, Int(buffer.frameLength))
    var sum: Float = 0
    for channelIndex in 0..<channelCount {
      let samples = channels[channelIndex]
      for frameIndex in 0..<frameCount {
        let sample = samples[frameIndex]
        sum += sample * sample
      }
    }
    let rms = sqrt(Double(sum) / Double(channelCount * frameCount))
    return min(1, max(0, pow(rms * 9, 0.65)))
  }

  private func requestSpeechPermission(_ completion: @escaping (Bool, String?) -> Void) {
    SFSpeechRecognizer.requestAuthorization { status in
      switch status {
      case .authorized:
        completion(true, nil)
      case .denied:
        completion(false, "语音识别权限被拒绝，请在系统设置的隐私与安全性中允许程小帮语音输入助手使用语音识别")
      case .restricted:
        completion(false, "系统限制了语音识别权限")
      case .notDetermined:
        completion(false, "语音识别权限尚未授权，请允许程小帮语音输入助手使用语音识别")
      @unknown default:
        completion(false, "未知的语音识别权限状态")
      }
    }
  }

  private func requestMicrophonePermission(_ completion: @escaping (Bool) -> Void) {
    if #available(macOS 14.0, *) {
      AVAudioApplication.requestRecordPermission { allowed in
        completion(allowed)
      }
    } else {
      AVCaptureDevice.requestAccess(for: .audio) { allowed in
        completion(allowed)
      }
    }
  }

  private func stopAudio() {
    if audioEngine.isRunning {
      audioEngine.stop()
    }
    if tapInstalled {
      audioEngine.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
    request?.endAudio()
  }

  private func finish(type: String, text: String, error: String?) {
    stateQueue.async {
      if self.finishStarted {
        return
      }
      self.finishStarted = true
      DispatchQueue.main.async {
        self.stopAudio()
        self.task?.cancel()
        var payload: [String: Any] = [
          "type": type,
          "language": self.language,
          "text": text,
          "elapsedMs": self.elapsedMs(),
        ]
        if let error {
          payload["error"] = error
        }
        self.emitter.emit(payload)
        self.emitter.close()
        CFRunLoopStop(CFRunLoopGetMain())
        exit(type == "error" ? EXIT_FAILURE : EXIT_SUCCESS)
      }
    }
  }

  private func elapsedMs() -> Int {
    Int(Date().timeIntervalSince(startedAt) * 1000)
  }
}

final class ControlFileReader {
  private let path: String
  private let onCommand: (String) -> Void
  private let queue = DispatchQueue(label: "chengxiaobang.system-speech.control")
  private var offset: UInt64 = 0
  private var timer: DispatchSourceTimer?

  init(path: String, onCommand: @escaping (String) -> Void) {
    self.path = path
    self.onCommand = onCommand
  }

  func start() {
    FileManager.default.createFile(atPath: path, contents: nil)
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now(), repeating: .milliseconds(100))
    timer.setEventHandler { [weak self] in
      self?.readNewCommands()
    }
    self.timer = timer
    timer.resume()
  }

  func stop() {
    timer?.cancel()
    timer = nil
  }

  private func readNewCommands() {
    guard let handle = FileHandle(forReadingAtPath: path) else {
      return
    }
    defer {
      try? handle.close()
    }
    do {
      try handle.seek(toOffset: offset)
      let data = handle.readDataToEndOfFile()
      guard !data.isEmpty else {
        return
      }
      offset += UInt64(data.count)
      guard let text = String(data: data, encoding: .utf8) else {
        return
      }
      for line in text.split(whereSeparator: \.isNewline) {
        let command = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if !command.isEmpty {
          onCommand(command)
        }
      }
    } catch {
      return
    }
  }
}

func value(after flag: String, in args: [String]) -> String? {
  guard let index = args.firstIndex(of: flag), index + 1 < args.count else {
    return nil
  }
  return args[index + 1]
}

let args = Array(CommandLine.arguments.dropFirst())
let command = args.first ?? "availability"
let language = value(after: "--lang", in: args) ?? "zh-CN"
let maxSeconds = Double(value(after: "--max-seconds", in: args) ?? "") ?? 120
let outputFile = value(after: "--output-file", in: args)
let controlFile = value(after: "--control-file", in: args)
let emitter = JsonEmitter(outputPath: outputFile)

if command == "availability" {
  let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language))
  emitter.emit([
    "type": "availability",
    "available": recognizer != nil,
    "language": language,
    "reason": recognizer == nil ? "当前系统不支持该语音识别语言" : "",
  ])
  exit(recognizer == nil ? 2 : 0)
}

guard command == "recognize" else {
  emitter.emit([
    "type": "error",
    "language": language,
    "error": "未知命令：\(command)",
  ])
  exit(64)
}

guard let controller = RecognitionController(language: language, maxSeconds: maxSeconds, emitter: emitter) else {
  emitter.emit([
    "type": "error",
    "language": language,
    "error": "当前系统不支持该语音识别语言",
  ])
  exit(2)
}

func handleControlCommand(_ command: String) {
  if command == "stop" {
    controller.requestStop()
  } else if command == "cancel" {
    controller.cancel()
  }
}

var controlReader: ControlFileReader?
if let controlFile {
  let reader = ControlFileReader(path: controlFile) { command in
    handleControlCommand(command)
    if command == "cancel" {
      controlReader?.stop()
    }
  }
  controlReader = reader
  reader.start()
} else {
  DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
      let command = line.trimmingCharacters(in: .whitespacesAndNewlines)
      handleControlCommand(command)
      if command == "cancel" {
        break
      }
    }
  }
}

controller.start()
RunLoop.main.run()
