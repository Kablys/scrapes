userId = 536080;
listId = 37318;

// headers: {
//     Priority: "u=1",
// }
baseOptions = {
  credentials: "include",
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.5",
    "Content-Type": "application/json",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Priority: "u=4",
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
  },
  method: "POST",
  mode: "cors",
};

async function getListData(page = 1, maxResults = 50) {
  try {
    const response = await fetch(
      `https://howlongtobeat.com/api/user/${userId}/collections/id/${listId}`,
      {
        ...baseOptions,
        ...{
          referrer: `https://howlongtobeat.com/user/Steamer/lists/${listId}/epic`,
          body: `{\"listId\":${listId},\"options\":{\"name\":[\"\"],\"platform\":\"\",\"sortType\":\"alpha\",\"sortView\":\"card\",\"sortOrder\":0},\"page\":${page},\"maxResults\":${maxResults},\"randomSeed\":37277}`,
        },
      }
    );
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(error);
  }
}
listData = await getListData(1, 400);

async function actionAdd(game) {
  body = JSON.stringify({
    game: game,
    quickAdd: {
      userId: userId,
      custom: "Next",
      custom2: "Wishlist",
      custom3: "Dropped",
      platform: "PC",
      storefront: "itch.io",
      type: "backlog",
    },
  });

  const response = await fetch(
    `https://howlongtobeat.com/api/game/${game.game_id}/user/${userId}/actionAdd`,
    {
      ...baseOptions,
      ...{
        referrer: `https://howlongtobeat.com/user/Steamer/lists/${listId}/epic`,
        body: body,
      },
    }
  );

  const data = await response.json();
  if (data !== true) {
    console.log(data);
  }
}

for (game of listData.data.games) {
  actionAdd(game);
}
