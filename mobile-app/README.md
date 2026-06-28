# Cardify Mobile

Cardify Mobile is an offline-first iOS SRS app for reviewing Cardify deck packages. It does not use Anki, AnkiWeb, AnkiConnect, or `.apkg`.

## Run on iOS Simulator

```bash
cd mobile-app
npm install
npx expo start
```

Press `i` to open the iOS Simulator.

## Run on Physical iPhone

1. Install Expo Go.
2. Run:

```bash
cd mobile-app
npx expo start
```

3. Scan the QR code.

## Native iOS Build

```bash
cd mobile-app
npx expo prebuild --platform ios
npx expo run:ios
```

For later internal distribution:

```bash
npx eas build --platform ios
```

## Manual Test Checklist

- App launches on iOS Simulator.
- Decks screen shows empty state.
- Seed Sample Deck creates reviewable cards.
- Study flow: Show Answer, then Again/Hard/Good/Easy.
- Closing/reopening keeps SQLite data.
- Import accepts `.cardify.json`.
- Duplicate import is rejected by `packageId`.
- Browse can search, edit, suspend, and delete.
- Stats show today/7-day review counts.
- Backup export creates a JSON file that can be shared.
