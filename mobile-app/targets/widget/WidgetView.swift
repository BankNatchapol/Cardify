import SwiftUI
import WidgetKit

// Lock Screen `accessoryRectangular` layout: a large character on the left,
// two small info lines stacked on the right — mirrors the Daily Hanzi
// layout this widget was modeled on.
struct CardifyWidgetView: View {
    var entry: CardifyEntry

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Text(entry.front)
                .font(.system(size: 28, weight: .bold))
                .lineLimit(1)
                .minimumScaleFactor(0.5)

            VStack(alignment: .leading, spacing: 1) {
                if !entry.subtitle1.isEmpty {
                    Text(entry.subtitle1)
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(1)
                }
                if !entry.subtitle2.isEmpty {
                    Text(entry.subtitle2)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .widgetURL(studyURL(forDeckId: entry.deckId, cardId: entry.cardId))
        .cardifyContainerBackground()
    }

    // Opens the app straight to Study for the widget's deck, on the exact
    // card the widget was showing — matches the route the app itself pushes
    // to (`/study/${deckId}`, see app/deck/[deckId].tsx) plus a `cardId`
    // query param the Study screen reads on its first load (see
    // app/study/[deckId].tsx's loadInitial). Without this, tapping the
    // widget would land on whatever the normal due-order queue picks next,
    // not the card you actually recognized on the Lock Screen. No deckId
    // (widget not yet configured) falls back to the bare scheme.
    private func studyURL (forDeckId deckId: String?, cardId: String?) -> URL? {
        guard let deckId, !deckId.isEmpty else { return URL(string: "cardify://") }
        var components = URLComponents()
        components.scheme = "cardify"
        components.host = "study"
        components.path = "/\(deckId)"
        if let cardId, !cardId.isEmpty {
            components.queryItems = [URLQueryItem(name: "cardId", value: cardId)]
        }
        return components.url
    }
}

private extension View {
    // containerBackground(for:) is iOS 17+ only, but this target's minimum
    // deployment is 16.0 (accessoryRectangular itself only needs 16) — guard
    // it so iOS 16 still compiles/runs, while iOS 17+ (including current iOS
    // versions, which enforce this) gets the required adoption. Skipping it
    // entirely — the previous state of this file — renders as a "Please
    // adopt container background API" placeholder instead of the real view.
    @ViewBuilder
    func cardifyContainerBackground () -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(.clear, for: .widget)
        } else {
            self.background(Color.clear)
        }
    }
}

struct CardifyWidget: Widget {
    let kind: String = "CardifyWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CardifyProvider()) { entry in
            CardifyWidgetView(entry: entry)
        }
        .configurationDisplayName("Cardify")
        .description("Shows a card you're still learning from your chosen deck.")
        .supportedFamilies([.accessoryRectangular])
    }
}
