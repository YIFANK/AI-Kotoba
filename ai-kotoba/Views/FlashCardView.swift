import SwiftUI
import SwiftData

struct FlashCardView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: FlashCardViewModel?

    var body: some View {
        VStack {
            if let viewModel {
                if viewModel.studySessionCompleted {
                    completionView(viewModel: viewModel)
                } else if viewModel.dueCards.isEmpty {
                    noDueCardsView
                } else {
                    reviewView(viewModel: viewModel)
                }
            }
        }
        .onAppear {
            if viewModel == nil {
                viewModel = FlashCardViewModel(modelContext: modelContext)
            } else {
                viewModel?.loadCards()
            }
        }
    }

    @ViewBuilder
    private func reviewView(viewModel: FlashCardViewModel) -> some View {
        VStack(spacing: 20) {
            // Progress
            HStack {
                Text("复习进度")
                    .font(.headline)

                Spacer()

                Text(viewModel.progress)
                    .font(.title3)
                    .fontWeight(.semibold)
            }
            .padding()

            Spacer()

            // Card
            if let card = viewModel.currentCard {
                CardFlipView(
                    card: card,
                    showingAnswer: viewModel.showingAnswer,
                    onFlip: { viewModel.flipCard() }
                )
            }

            Spacer()

            // Rating buttons
            if viewModel.showingAnswer {
                ratingButtons(viewModel: viewModel)
            } else {
                Button("显示答案") {
                    viewModel.flipCard()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
        }
        .padding()
    }

    @ViewBuilder
    private func ratingButtons(viewModel: FlashCardViewModel) -> some View {
        HStack(spacing: 16) {
            RatingButton(title: "再来", color: .red) {
                viewModel.rateCard(quality: 0)
            }

            RatingButton(title: "困难", color: .orange) {
                viewModel.rateCard(quality: 3)
            }

            RatingButton(title: "良好", color: .blue) {
                viewModel.rateCard(quality: 4)
            }

            RatingButton(title: "简单", color: .green) {
                viewModel.rateCard(quality: 5)
            }
        }
    }

    @ViewBuilder
    private func completionView(viewModel: FlashCardViewModel) -> some View {
        VStack(spacing: 20) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 80))
                .foregroundColor(.green)

            Text("复习完成！")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("您已完成今天的所有复习卡片")
                .foregroundColor(.secondary)

            Button("重新开始") {
                viewModel.resetSession()
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }

    private var noDueCardsView: some View {
        ContentUnavailableView(
            "没有需要复习的卡片",
            systemImage: "rectangle.stack",
            description: Text("从词汇表创建复习卡片开始学习")
        )
    }
}

struct CardFlipView: View {
    let card: FlashCard
    let showingAnswer: Bool
    let onFlip: () -> Void

    @State private var rotation: Double = 0

    var body: some View {
        ZStack {
            // Front of card
            CardFace(text: card.front, label: "问题")
                .opacity(rotation < 90 ? 1 : 0)
                .rotation3DEffect(
                    .degrees(rotation),
                    axis: (x: 0.0, y: 1.0, z: 0.0)
                )

            // Back of card (pre-rotated 180 degrees so it faces forward when flipped)
            CardFace(text: card.back, label: "答案")
                .opacity(rotation >= 90 ? 1 : 0)
                .rotation3DEffect(
                    .degrees(rotation + 180),
                    axis: (x: 0.0, y: 1.0, z: 0.0)
                )
        }
        .onTapGesture {
            onFlip()
        }
        .onChange(of: showingAnswer) { _, newValue in
            withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
                rotation = newValue ? 180 : 0
            }
        }
    }
}

struct CardFace: View {
    let text: String
    let label: String

    var body: some View {
        VStack {
            Spacer()

            Text(text)
                .font(.title)
                .fontWeight(.semibold)
                .multilineTextAlignment(.center)
                .padding()

            Spacer()

            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
                .padding(.bottom)
        }
        .frame(maxWidth: 500, maxHeight: 300)
        .background(Color.gray.opacity(0.1))
        .cornerRadius(16)
    }
}

struct RatingButton: View {
    let title: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.headline)
                .foregroundColor(.white)
                .frame(width: 100, height: 50)
                .background(color)
                .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }
}
