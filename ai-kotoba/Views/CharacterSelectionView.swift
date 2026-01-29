import SwiftUI

struct CharacterSelectionView: View {
    let scenario: Scenario
    let onSelect: (PlayingCharacter) -> Void
    let onBack: () -> Void

    @State private var selectedCharacter: PlayingCharacter = .both

    private var speakers: [String] {
        var seenSpeakers = Set<String>()
        var speakersInOrder: [String] = []
        for line in scenario.conversationLines.sorted(by: { $0.orderIndex < $1.orderIndex }) {
            if !seenSpeakers.contains(line.speaker) {
                seenSpeakers.insert(line.speaker)
                speakersInOrder.append(line.speaker)
            }
        }
        return speakersInOrder
    }

    private var personA: String {
        speakers.first ?? "Person A"
    }

    private var personB: String {
        speakers.count > 1 ? speakers[1] : "Person B"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Button(action: onBack) {
                    Label("返回", systemImage: "chevron.left")
                }

                Spacer()

                Text("选择角色")
                    .font(.headline)

                Spacer()

                // Placeholder for balance
                Color.clear
                    .frame(width: 60)
            }
            .padding()
            .background(Color.gray.opacity(0.1))

            Divider()

            // Content
            ScrollView {
                VStack(spacing: 24) {
                    // Title and description
                    VStack(spacing: 12) {
                        Image(systemName: "person.2.fill")
                            .font(.system(size: 60))
                            .foregroundColor(.blue)

                        Text("选择您要扮演的角色")
                            .font(.title2)
                            .fontWeight(.bold)

                        Text("在互动模式中，您需要将中文翻译成日语。选择您想要扮演的角色。")
                            .font(.body)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }
                    .padding(.top, 40)

                    // Character selection cards
                    VStack(spacing: 16) {
                        // Person A
                        CharacterCard(
                            title: personA,
                            description: "仅扮演 \(personA)，AI 将扮演 \(personB)",
                            icon: "person.fill",
                            color: .blue,
                            isSelected: selectedCharacter == .personA,
                            onTap: { selectedCharacter = .personA }
                        )

                        // Person B
                        CharacterCard(
                            title: personB,
                            description: "仅扮演 \(personB)，AI 将扮演 \(personA)",
                            icon: "person.fill",
                            color: .green,
                            isSelected: selectedCharacter == .personB,
                            onTap: { selectedCharacter = .personB }
                        )

                        // Both
                        CharacterCard(
                            title: "两个角色",
                            description: "扮演对话中的所有角色",
                            icon: "person.2.fill",
                            color: .purple,
                            isSelected: selectedCharacter == .both,
                            onTap: { selectedCharacter = .both }
                        )
                    }
                    .padding(.horizontal)

                    // Start button
                    Button(action: {
                        onSelect(selectedCharacter)
                    }) {
                        Text("开始练习")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding(.horizontal)
                    .padding(.top, 8)
                }
                .padding(.bottom, 40)
            }
        }
    }
}

struct CharacterCard: View {
    let title: String
    let description: String
    let icon: String
    let color: Color
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 16) {
                // Icon
                ZStack {
                    Circle()
                        .fill(color.opacity(0.1))
                        .frame(width: 60, height: 60)

                    Image(systemName: icon)
                        .font(.title2)
                        .foregroundColor(color)
                }

                // Text
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline)
                        .foregroundColor(.primary)

                    Text(description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.leading)
                }

                Spacer()

                // Selection indicator
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.title2)
                        .foregroundColor(color)
                } else {
                    Image(systemName: "circle")
                        .font(.title2)
                        .foregroundColor(.gray.opacity(0.3))
                }
            }
            .padding()
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(isSelected ? color.opacity(0.05) : Color.gray.opacity(0.05))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? color : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
    }
}
