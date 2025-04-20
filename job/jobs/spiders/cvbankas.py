# -*- coding: utf-8 -*-
import scrapy


class CvbankasSpider(scrapy.Spider):
    name = 'cvbankas'
    allowed_domains = ['cvbankas.lt']
    start_urls = ['https://www.cvbankas.lt/?miestas=Vilnius&padalinys%5B%5D=76&keyw=',
                  'https://www.cvbankas.lt/?miestas=Vilnius&padalinys%5B0%5D=76&page=2'] # added second page so pagination works correctly

    custom_settings = {

        'CONCURRENT_REQUESTS_PER_DOMAIN' : '1',

        'AUTOTHROTTLE_ENABLED' : 'True',
        'AUTOTHROTTLE_START_DELAY' : '2.0',
        'AUTOTHROTTLE_MAX_DELAY' : '60.0',
        'AUTOTHROTTLE_TARGET_CONCURRENCY' : '1.0',
        'AUTOTHROTTLE_DEBUG' : 'True',

        'HTTPCACHE_ENABLED' : 'True',
        'HTTPCACHE_EXPIRATION_SECS' : '0',  # Never expire.
    }

    def parse(self, response):
        # go to job offers
        for job in response.css('.list_a_has_logo::attr(href)').getall():
            yield scrapy.Request(url=job, callback=self.parse_job)

        # go to next page
        next_page = response.css('li:nth-child(3) .prev_next::attr(href)').get()
        if next_page:
            yield response.follow(next_page, callback=self.parse)


    def parse_job(self, response):
        descriptions = response.css('.jobad_subheading::text , .jobad_txt::text , li::text').getall()
        yield {
            'title' : response.css('#jobad_heading1::text').get(),
            'salary': response.css('.salary_emphasised::text').get(),
            'description' : " ".join([text.strip() for text in descriptions]),
            'company name': response.css('#jobad_company_title::text').get(),
            'company desc': response.css('#jobad_company_description::text').get(),
            'url'   : response.request.url,
        }
