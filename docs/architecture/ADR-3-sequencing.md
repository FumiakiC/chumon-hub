# ADR-3: インフラ・認証・DB の移行順序

- 状態: 検討中
- 関連: [ADR-1](ADR-1-runtime.md)（実行基盤）／[ADR-2](ADR-2-in-app-identity.md)（アプリ内認証）／[ADR-5](ADR-5-database.md)（DB 選定）／計画書 基本設計 §3（非同期ジョブ実行基盤）

> 2026-10-02: repo への移設時に、DB 選定を [ADR-5](ADR-5-database.md) として分離した。本 ADR は、3つの決定を動かす**順序**だけを扱う。

## 背景 / 課題（結合関係）

- Cloud Run 化は、Cloudflare Access / Tunnel の撤去とセット。
- アプリ内認証は、ユーザーの永続化（DB）が前提。
- 非同期ジョブ実行基盤（Cloud Tasks 等。計画書 基本設計 §3-4）も ADR-1 と結合する。

## 現時点の傾き

① Cloud Run へリフト&シフト（認証は当面 Access 併存）→ ② Phase 5 の DB 基盤確定（ADR-5）→ ③ アプリ内認証（Auth0）へ移行し Access を撤去。

3つを同時に動かさず、別エポックで行う。
