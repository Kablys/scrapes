function _1(md){return(
md`# Scrapping`
)}

function _url(CorstProxyURL){return(
CorstProxyURL("https://lastmile.lt/")
)}

function _html(url){return(
fetch(url).then((response) => response.text())
)}

function _jsonObject(DOMParser,html)
{
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const script = doc.querySelector('script#__NEXT_DATA__');
    const jsonString = script.textContent;
    return JSON.parse(jsonString);
}


function _5(md){return(
md`## Chains`
)}

function _chains(jsonObject)
{
  let chains ={}
  for (const chain of jsonObject.props.pageProps.chainsOrChain){
    //console.log(chain.id, chain.name.en, chain.tags, chain.slugs)
    chains[chain.name.en] = chain.id
  }
  return chains
}


function _7(Inputs,jsonObject){return(
Inputs.table(jsonObject.props.pageProps.chainsOrChain, {
  columns: [
    "id",
    "name",
    "slugs",
    "tags"
  ],
  format: {
    name:x => x.en
  }
})
)}

function _8(md){return(
md`## Categories`
)}

function _categories(jsonObject)
{
  let categories = {}
  for (const category of jsonObject.props.pageProps.categories){
      categories[category.name.en] = category.id
      for (const sub of category.subcategories){
          categories[sub.name.en] = sub.id
      }
  }
  return categories
}


function _categories2(jsonObject)
{
  let categories = []
  for (const category of jsonObject.props.pageProps.categories){
    let name = category.name.en.replace(" ","_");
    categories.push({name: name});
    for (const sub of category.subcategories){
      let sub_name = name + "." + sub.name.en.replace(" ","_")
      categories.push({name: sub_name});
    }
  }
  return categories
}


function _11(jsonObject){return(
jsonObject.props.pageProps.categories
)}

function _12(Plot,categories2){return(
Plot.plot({
  axis: null,
  marginRight: 160,
  height: 1800,
  marks: [
    Plot.tree(categories2, {path: "name", delimiter: "."})
  ]
})
)}

function _13(md){return(
md`# IKI store data`
)}

function _14(md){return(
md`\`Njo8Yi5Tm5cSqAlI8eo_Q\` - changes at some point. Update by visiting website and looking at network tools.`
)}

function _iki_raw_data(CorstProxyURL){return(
fetch(CorstProxyURL ("https://lastmile.lt/_next/data/g1hLxHJfU06IheTrrzv6E/lt/chain/IKI.json"))
.then((response) => response.json())
)}

function _16(md){return(
md`## Deeper categories`
)}

function _deeper_categories(iki_json)
{
  for (const category of iki_json.pageProps.categories) {
      console.log(category.name.en)
      for (const sub of category.subcategories) {
          console.log("\t",sub.name.en)
          for (const subsub of sub.subcategories){
              console.log("\t\t",subsub.name.en)
  
          }
      }
  }
}


function _dig_names(){return(
function dig_names(obj){
  let subC = obj.subcategories
  
  if (Array.isArray(subC) && subC.length === 0){
    return obj.name.en
  }
  let sub_names = subC.flatMap((sub) => dig_names(sub))
  return [obj.name.en].concat(sub_names)
}
)}

function _19(iki_raw_data){return(
iki_raw_data.pageProps.categories
)}

function _flattenedCategories(iki_raw_data,dig_names){return(
iki_raw_data.pageProps.categories.flatMap((cat) => dig_names(cat))
)}

function _21(md){return(
md`# Get product data in bulk`
)}

function _view_products(){return(
async function view_products(limit, fromIndex, chainIds, categoryIds,  slim) {
    const product_url = 'https://search-dvbpbqktxq-lz.a.run.app/view_products';
    let body = {
      "limit": limit,
      "params": {
        "type": "view_products",
        "isActive": true,
        "isApproved": true,
        "filter": {},
        "chainIds": chainIds,
        "storeIds": [],
        "categoryIds": categoryIds,
        "isUsingStock": true
      },
      "fromIndex": fromIndex,
      "slim": slim
    }
    let options = {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body)
    };
    
    try {
      let response = await fetch(product_url, options);
      let data = await response.json();
      return data
    } catch (error) {
      console.error(error);
    }
}
)}

async function _products(view_products)
{
  let total_count = (await view_products(0, 0, ["CvKfTzV4TN5U8BTMF1Hl"], [], false)).count;
  let products = [];
   for(let i = 0; i < total_count; i += 1000) {
    let product = await view_products(1000, i, ["CvKfTzV4TN5U8BTMF1Hl"], [], false);
    products.push(...product.data);
  }
  return products;
}


function _serialize(){return(
function serialize (data) {
 let s = JSON.stringify(data, null, "  ");
 return new Blob([s], {type: "application/json"}) 
}
)}

function _25(DOM,serialize,products){return(
DOM.download(serialize(products), null, "Download JSON")
)}

function _26(md){return(
md`# Functions`
)}

function _CorstProxyURL(){return(
function CorstProxyURL(url) {
  let encoded = encodeURIComponent(url);
  return 'https://corsproxy.io/?url=' + encoded
}
)}

export default function define(runtime, observer) {
  const main = runtime.module();
  main.variable(observer()).define(["md"], _1);
  main.variable(observer("url")).define("url", ["CorstProxyURL"], _url);
  main.variable(observer("html")).define("html", ["url"], _html);
  main.variable(observer("jsonObject")).define("jsonObject", ["DOMParser","html"], _jsonObject);
  main.variable(observer()).define(["md"], _5);
  main.variable(observer("chains")).define("chains", ["jsonObject"], _chains);
  main.variable(observer()).define(["Inputs","jsonObject"], _7);
  main.variable(observer()).define(["md"], _8);
  main.variable(observer("categories")).define("categories", ["jsonObject"], _categories);
  main.variable(observer("categories2")).define("categories2", ["jsonObject"], _categories2);
  main.variable(observer()).define(["jsonObject"], _11);
  main.variable(observer()).define(["Plot","categories2"], _12);
  main.variable(observer()).define(["md"], _13);
  main.variable(observer()).define(["md"], _14);
  main.variable(observer("iki_raw_data")).define("iki_raw_data", ["CorstProxyURL"], _iki_raw_data);
  main.variable(observer()).define(["md"], _16);
  main.variable(observer("deeper_categories")).define("deeper_categories", ["iki_json"], _deeper_categories);
  main.variable(observer("dig_names")).define("dig_names", _dig_names);
  main.variable(observer()).define(["iki_raw_data"], _19);
  main.variable(observer("flattenedCategories")).define("flattenedCategories", ["iki_raw_data","dig_names"], _flattenedCategories);
  main.variable(observer()).define(["md"], _21);
  main.variable(observer("view_products")).define("view_products", _view_products);
  main.variable(observer("products")).define("products", ["view_products"], _products);
  main.variable(observer("serialize")).define("serialize", _serialize);
  main.variable(observer()).define(["DOM","serialize","products"], _25);
  main.variable(observer()).define(["md"], _26);
  main.variable(observer("CorstProxyURL")).define("CorstProxyURL", _CorstProxyURL);
  return main;
}
