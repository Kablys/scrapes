import requests
import json
from datetime import datetime
import time
from bs4 import BeautifulSoup

while True:
    try:
        # OLD
        # r = requests.get('http://gymplius.lt/klubo_uzimtumas/?die=1', headers={'User-Agent': 'Foo bar'})
        # body = r.text
        # dic = json.loads(body)

        # NEW
        r = requests.get('https://gymplius.lt/klubu-uzimtumas', verify=False)
        soup = BeautifulSoup(r.text)
        containers = soup.find_all(class_ = "occupancy-container")
        [list(filter(None, c.text.split("\n")))[1:] for c in containers]
        # TODO saving
        with open("gym_data.csv", "a") as f:
            f.write(f"{datetime.now()}, ")
            for key in dic:
                f.write(f"{dic[key]}, ")
            f.write("\n")
    except Exception as e:
        print(e)
    finally:
        time.sleep(60)
