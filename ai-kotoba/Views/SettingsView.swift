import SwiftUI

struct SettingsView: View {
    @State private var claudeAPIKey = ""
    @State private var openaiAPIKey = ""
    @State private var showClaudeKey = false
    @State private var showOpenAIKey = false
    @State private var saveMessage: String?
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("设置")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Spacer()
            }
            .padding()
            .background(Color.gray.opacity(0.1))

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 32) {
                    // API Keys Section
                    VStack(alignment: .leading, spacing: 16) {
                        Text("API 密钥")
                            .font(.title2)
                            .fontWeight(.semibold)

                        Text("配置您的 AI 服务 API 密钥以使用相应的服务")
                            .font(.body)
                            .foregroundColor(.secondary)

                        // Claude API Key
                        apiKeySection(
                            title: "Claude API Key",
                            keyBinding: $claudeAPIKey,
                            showKeyBinding: $showClaudeKey,
                            hasKey: APIKeyManager.shared.hasAPIKey(),
                            onSave: saveClaude,
                            onDelete: deleteClaude,
                            getInstructions: {
                                "前往 console.anthropic.com 获取 API 密钥"
                            }
                        )

                        Divider()

                        // OpenAI API Key
                        apiKeySection(
                            title: "OpenAI API Key",
                            keyBinding: $openaiAPIKey,
                            showKeyBinding: $showOpenAIKey,
                            hasKey: APIKeyManager.shared.hasOpenAIKey(),
                            onSave: saveOpenAI,
                            onDelete: deleteOpenAI,
                            getInstructions: {
                                "前往 platform.openai.com 获取 API 密钥"
                            }
                        )
                    }

                    // About Section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("关于")
                            .font(.title2)
                            .fontWeight(.semibold)

                        VStack(alignment: .leading, spacing: 8) {
                            InfoRow(label: "应用名称", value: "AI-Kotoba")
                            InfoRow(label: "版本", value: "1.0.0")
                            InfoRow(label: "描述", value: "日语学习助手")
                        }
                    }

                    // Usage Instructions
                    VStack(alignment: .leading, spacing: 12) {
                        Text("使用说明")
                            .font(.title2)
                            .fontWeight(.semibold)

                        Text("""
                        1. 在「练习」页面输入场景，选择模式和 AI 服务
                        2. 常规模式：查看完整对话，学习词汇
                        3. 互动模式：逐句翻译练习，获得 AI 反馈
                        4. 点击对话行可以听到日语发音
                        5. 在「历史」中查看所有生成的场景
                        6. 点击星标将场景添加到收藏夹
                        7. 在「词汇」中添加和管理词汇
                        8. 使用「复习卡片」进行间隔重复学习
                        """)
                        .font(.caption)
                        .foregroundColor(.secondary)
                    }

                    // Messages
                    if let message = saveMessage {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text(message)
                                .foregroundColor(.green)
                        }
                        .font(.caption)
                    }

                    if let error = errorMessage {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.red)
                            Text(error)
                                .foregroundColor(.red)
                        }
                        .font(.caption)
                    }
                }
                .padding()
            }
        }
        .onAppear {
            loadAPIKeys()
        }
    }

    @ViewBuilder
    private func apiKeySection(
        title: String,
        keyBinding: Binding<String>,
        showKeyBinding: Binding<Bool>,
        hasKey: Bool,
        onSave: @escaping () -> Void,
        onDelete: @escaping () -> Void,
        getInstructions: () -> String
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(title)
                    .font(.headline)

                Spacer()

                if hasKey {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text("已配置")
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                } else {
                    HStack(spacing: 4) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundColor(.orange)
                        Text("未配置")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }
            }

            Text(getInstructions())
                .font(.caption)
                .foregroundColor(.secondary)

            HStack {
                Group {
                    if showKeyBinding.wrappedValue {
                        TextField("输入 API 密钥", text: keyBinding)
                    } else {
                        SecureField("输入 API 密钥", text: keyBinding)
                    }
                }
                .textFieldStyle(.roundedBorder)

                Button(action: {
                    showKeyBinding.wrappedValue.toggle()
                }) {
                    Image(systemName: showKeyBinding.wrappedValue ? "eye.slash" : "eye")
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }

            HStack {
                Button(action: onSave) {
                    Text("保存")
                        .frame(width: 80)
                }
                .buttonStyle(.borderedProminent)
                .disabled(keyBinding.wrappedValue.isEmpty)

                if hasKey {
                    Button(action: onDelete) {
                        Text("删除")
                            .frame(width: 80)
                    }
                    .buttonStyle(.bordered)
                    .foregroundColor(.red)
                }
            }
        }
        .padding()
        .background(Color.gray.opacity(0.05))
        .cornerRadius(8)
    }

    // MARK: - Actions

    private func loadAPIKeys() {
        // Try to load masked versions (just show if they exist)
        if APIKeyManager.shared.hasAPIKey() {
            claudeAPIKey = "" // Don't load actual key for security
        }
        if APIKeyManager.shared.hasOpenAIKey() {
            openaiAPIKey = "" // Don't load actual key for security
        }
    }

    private func saveClaude() {
        do {
            try APIKeyManager.shared.saveAPIKey(claudeAPIKey)
            saveMessage = "Claude API 密钥已保存"
            errorMessage = nil
            claudeAPIKey = ""

            // Clear message after 3 seconds
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                saveMessage = nil
            }
        } catch {
            errorMessage = "保存失败: \(error.localizedDescription)"
            saveMessage = nil
        }
    }

    private func saveOpenAI() {
        do {
            try APIKeyManager.shared.saveOpenAIKey(openaiAPIKey)
            saveMessage = "OpenAI API 密钥已保存"
            errorMessage = nil
            openaiAPIKey = ""

            // Clear message after 3 seconds
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                saveMessage = nil
            }
        } catch {
            errorMessage = "保存失败: \(error.localizedDescription)"
            saveMessage = nil
        }
    }

    private func deleteClaude() {
        do {
            try APIKeyManager.shared.deleteAPIKey()
            saveMessage = "Claude API 密钥已删除"
            errorMessage = nil
            claudeAPIKey = ""

            // Clear message after 3 seconds
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                saveMessage = nil
            }
        } catch {
            errorMessage = "删除失败: \(error.localizedDescription)"
            saveMessage = nil
        }
    }

    private func deleteOpenAI() {
        do {
            try APIKeyManager.shared.deleteOpenAIKey()
            saveMessage = "OpenAI API 密钥已删除"
            errorMessage = nil
            openaiAPIKey = ""

            // Clear message after 3 seconds
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                saveMessage = nil
            }
        } catch {
            errorMessage = "删除失败: \(error.localizedDescription)"
            saveMessage = nil
        }
    }
}

struct InfoRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.medium)
        }
        .font(.body)
    }
}
