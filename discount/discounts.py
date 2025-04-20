import requests, bs4
from urllib.parse import urljoin
#LSP
#TODO get categorys
testSite = open('LSP.html').read()
# site = 'http://nostarch.com'
# res = requests.get(testSite)
# res.raise_for_status() #raises exception if failed to get data
# soup = bs4.BeautifulSoup(testSite, "lxml")
test = soup.find_all('td')
for discount in test:
	link = discount.div.a #link to discount website
	if (link != None):
		print(link.get('href'))
	print(discount.div.get_text()) #title for discoutn
	print(discount.div.next_sibling.next_sibling.get_text()) #discripton of discount
	print()

#RIMI
baseUrl = 'https://www.rimi.lt'
testSite = open('RIMI.html').read()
soup = bs4.BeautifulSoup(testSite, "lxml")
discounts = soup.find_all("div", class_="row list-block")
for dis in discounts:
	relativeUrl = dis.a.get('href') #relative link to discripton
	print(urljoin(baseUrl, relativeUrl))
	print(dis.h2.get_text()) #discription
	print()


#OmniID
#Discount page
#https://www.omniid.lt/pasiulymai/klasikine/visi-pasiulymai
#Sadly at the bottom of the page there is button that gets more results
#but I fount way around it, if you add "puslpais/2", you get results for 2 page
#https://www.omniid.lt/pasiulymai/klasikine/visi-pasiulymai/puslapis/1

#TODO
#Daily Card
#Mylimiausia
#IKI, Maxima, Norfa, Aibe, 
