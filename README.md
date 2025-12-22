# CHUMON HUB (Development Preview)

CHUMON HUBは、見積書から注文書を自動生成・管理するための統合プラットフォームです。
Google Gemini API (Multimodal AI) を活用し、画像やPDFの見積書から明細情報を高精度に抽出し、注文作成プロセスを効率化します。

**⚠️ 注意: 本プロジェクトは現在開発中（Work in Progress）です。**

## 🚀 主な機能

* **AI注文書作成**: アップロードされた見積書（画像/PDF）を最新の **Gemini 2.5 Flash** モデルで解析し、注文情報を自動入力します。
* **ドラッグ＆ドロップ UI**: 直感的なファイル操作とプレビュー機能を提供します。
* **リアルタイム編集**: AIが抽出したデータをフォーム上で修正・確認できます。
* **モダンなUI**: Tailwind CSS, shadcn/ui を採用したレスポンシブデザインです。

## 🛠 技術スタック

* **Framework**: Next.js 16 (App Router)
* **Language**: TypeScript
* **AI/LLM**: Google Generative AI SDK (`gemini-2.5-flash`)
* **UI Components**: shadcn/ui, Radix UI, Lucide React
* **Styling**: Tailwind CSS v4
* **Validation**: Zod, React Hook Form
* **Package Manager**: pnpm

## ⚙️ インフラストラクチャ & デプロイ

現在、以下の構成で運用・開発を行っています。

* **Hosting**: AWS Lightsail
* **Security/Access Control**: Cloudflare Access (Zero Trust)
    * 開発環境およびステージング環境へのアクセスはCloudflareによって保護されています。

### 今後のロードマップ
* **コンテナ化**: Dockerによるアプリケーションのコンテナ化
* **オーケストレーション**: Kubernetes (K8s) への移行・運用を検討中
* **注文管理機能**: 履歴管理、ステータス追跡機能の実装

## 💻 ローカルでの開発手順

### 前提条件
* Node.js (v18以上推奨)
* pnpm
* Google AI Studio の API Key

### セットアップ

1. **リポジトリのクローン**
   ```bash
   git clone <repository-url>
   cd <repository-name>
