/**
 * Slack投稿関連の処理
 */

/**
 * Slackに投稿する
 */
export async function postToSlack(
  webhookUrl: string,
  message: string,
): Promise<void> {
  console.log("Slack投稿開始", { webhookUrl, messageLength: message.length });

  try {
    const payload = {
      text: message,
    };

    console.log("Slack投稿内容", { payload });

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
      console.error("Slack投稿失敗:", errorMsg);
      throw new Error(errorMsg);
    }

    console.log("Slack投稿成功");
  } catch (error) {
    console.error("Slack投稿失敗:", error);
    throw error;
  }
}
